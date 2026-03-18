-- =============================================================================
-- Phase 5.4: Knowledge Graph Worker RPC Functions
-- =============================================================================

-- -----------------------------------------------------------------------------
-- worker_kg_get_pending_documents: Safely fetch the next batch
-- -----------------------------------------------------------------------------
create or replace function worker_kg_get_pending_documents(
  p_owner_id uuid,
  p_limit int default 10
)
returns table(
  document_id uuid,
  document_type text,
  document_date date,
  extracted_data jsonb
)
language plpgsql
security definer
as $$
begin
  -- Use SKIP LOCKED for safe concurrent access, though BullMQ group 
  -- concurrency = 1 per owner_id makes this mostly a defensive measure.
  return query
    with batch as (
      select d.id as doc_id
      from public.documents d
      where d.owner_id = p_owner_id 
        and d.kg_sync_status = 'pending'
        and d.deleted_at is null
        and d.process_status IN ('completed', 'rejected')
        and d.document_type NOT IN ('other.irrelevant', 'splitted')
      order by d.created_at asc
      limit p_limit
      for update skip locked
    )
    -- Mark them as processing so another run doesn't grab them if this transaction holds
    -- (This UPDATE is visible immediately to other transactions due to FOR UPDATE)
    , updated as (
      update public.documents d
      set 
        kg_sync_status = 'processing',
        updated_at = now()
      from batch b
      where d.id = b.doc_id
      returning d.id, d.document_type, d.document_date
    )
    select 
      u.id as document_id,
      u.document_type,
      u.document_date,
      dp.extracted_data
    from updated u
    left join public.document_private_decoded dp on dp.document_id = u.id;
end;
$$;

revoke all on function worker_kg_get_pending_documents(uuid, int) from public, anon, authenticated;
grant execute on function worker_kg_get_pending_documents(uuid, int) to service_role;

-- -----------------------------------------------------------------------------
-- worker_kg_mark_batch_synced: Mark a successful batch
-- -----------------------------------------------------------------------------
create or replace function worker_kg_mark_batch_synced(
  p_document_ids uuid[]
)
returns boolean
language plpgsql
security definer
as $$
begin
  update public.documents
  set 
    kg_sync_status = 'synced',
    updated_at = now()
  where id = any(p_document_ids);
  
  return true;
end;
$$;

revoke all on function worker_kg_mark_batch_synced(uuid[]) from public, anon, authenticated;
grant execute on function worker_kg_mark_batch_synced(uuid[]) to service_role;

-- -----------------------------------------------------------------------------
-- worker_kg_mark_batch_failed: Return documents to pending
-- -----------------------------------------------------------------------------
create or replace function worker_kg_mark_batch_failed(
  p_document_ids uuid[]
)
returns boolean
language plpgsql
security definer
as $$
begin
  -- Revert to pending so they can be retried
  update public.documents
  set 
    kg_sync_status = 'pending',
    updated_at = now()
  where id = any(p_document_ids);
  
  return true;
end;
$$;

revoke all on function worker_kg_mark_batch_failed(uuid[]) from public, anon, authenticated;
grant execute on function worker_kg_mark_batch_failed(uuid[]) to service_role;

-- -----------------------------------------------------------------------------
-- worker_kg_get_graph: Fetch decoded knowledge graph for an owner
-- -----------------------------------------------------------------------------
create or replace function worker_kg_get_graph(
  p_owner_id uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_entities jsonb;
  v_relationships jsonb;
  v_overrides jsonb;
begin
  select coalesce(jsonb_agg(row_to_json(e)), '[]'::jsonb) into v_entities
  from public.kg_entities_decoded e
  where owner_id = p_owner_id and deleted_at is null;

  select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb) into v_relationships
  from public.kg_relationships_decoded r
  where owner_id = p_owner_id and deleted_at is null;

  select coalesce(jsonb_agg(row_to_json(c)), '[]'::jsonb) into v_overrides
  from public.kg_confirmed_overrides_decoded c
  where owner_id = p_owner_id;

  return jsonb_build_object(
    'entities', v_entities,
    'relationships', v_relationships,
    'confirmed_overrides', v_overrides
  );
end;
$$;

revoke all on function worker_kg_get_graph(uuid) from public, anon, authenticated;
grant execute on function worker_kg_get_graph(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- worker_kg_ensure_owner_entity: Auto-create owner node
-- -----------------------------------------------------------------------------
create or replace function worker_kg_ensure_owner_entity(
  p_owner_id uuid
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_id uuid;
begin
  select id into v_id
  from public.kg_entities
  where owner_id = p_owner_id 
    and is_owner = true 
    and deleted_at is null;

  if v_id is null then
    insert into public.kg_entities (
      owner_id, 
      is_owner, 
      encrypted_data, 
      master_key_version
    )
    values (
      p_owner_id,
      true,
      public.encrypt_jsonb('{}'::jsonb),
      public.get_current_master_key_version()
    )
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

revoke all on function worker_kg_ensure_owner_entity(uuid) from public, anon, authenticated;
grant execute on function worker_kg_ensure_owner_entity(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- worker_kg_apply_mutations: Core logic for pushing parsed LLM patches
-- -----------------------------------------------------------------------------
create or replace function worker_kg_apply_mutations(
  p_owner_id uuid,
  p_mutations jsonb,
  p_attributions jsonb,
  p_document_ids uuid[],
  p_raw_llm_response jsonb default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_master_key_version int;
  
  v_entities_added int := 0;
  v_entities_updated int := 0;
  v_relationships_added int := 0;
  v_relationships_updated int := 0;
  v_relationships_closed int := 0;
  v_attributions_added int := 0;

  v_record jsonb;
  v_temp_id_map jsonb := '{}'::jsonb;
  v_new_uuid uuid;

  v_target_id uuid;
  v_source_id uuid;

  v_merged jsonb;
  v_val jsonb;
  v_path text;
  v_path_keys text[];  
  v_override record;
begin
  v_master_key_version := public.get_current_master_key_version();

  if p_mutations ? 'entities' then
    for v_record in select * from jsonb_array_elements(p_mutations->'entities') loop

      begin
        -- 1. Update existing entities when id is an existing uuid
        raise log '1. Update existing entities when id is an existing uuid';

        v_target_id := (v_record->>'id')::uuid;

        v_merged := coalesce(v_record->'data', '{}'::jsonb);
        for v_override in select * from public.kg_confirmed_overrides where target_type = 'entity' and target_id = v_target_id loop
          v_path := regexp_replace(v_override->>'json_path', '^\$\.', '');
          v_path_keys := ('{' || regexp_replace(v_path, '\.', ',', 'g') || '}')::text[];
          v_merged := jsonb_set(v_merged, v_path_keys, v_override->'confirmed_value', true);
        end loop;

        update public.kg_entities 
        set encrypted_data = public.encrypt_jsonb(v_merged, v_master_key_version)
        where id = (v_record->>'id')::uuid;

        v_entities_updated := v_entities_updated + 1;

      exception when invalid_text_representation then
        -- 2. Insert new entities when id is a temp_id
        raise log '2. Insert new entities when id is a temp_id';

        v_new_uuid := gen_random_uuid();
        v_temp_id_map := jsonb_set(v_temp_id_map, array[v_record->>'id'], to_jsonb(v_new_uuid));

        insert into public.kg_entities (id, owner_id, encrypted_data, master_key_version)
        values (v_new_uuid, p_owner_id, public.encrypt_jsonb(coalesce(v_record->'data', '{}'::jsonb), v_master_key_version), v_master_key_version);
        
        v_entities_added := v_entities_added + 1;
      end;

    end loop;
  end if;

  if p_mutations ? 'relationships' then
    for v_record in select * from jsonb_array_elements(p_mutations->'relationships') loop

      begin
        -- 1. Update existing relationships when id is an existing uuid
        raise log '3. Update existing relationships when id is an existing uuid';

        v_target_id := (v_record->>'id')::uuid;

        v_merged := coalesce(v_record->'data', '{}'::jsonb);
        for v_override in select * from public.kg_confirmed_overrides where target_type = 'relationship' and target_id = v_target_id loop
          v_path := regexp_replace(v_override->>'json_path', '^\$\.', '');
          v_path_keys := ('{' || regexp_replace(v_path, '\.', ',', 'g') || '}')::text[];
          v_merged := jsonb_set(v_merged, v_path_keys, v_override->'confirmed_value', true);
        end loop;

        update public.kg_relationships 
        set encrypted_data = public.encrypt_jsonb(v_merged, v_master_key_version),
            valid_from = least(v_record->>'valid_from', valid_from),
            valid_to = greatest(v_record->>'valid_to', valid_to)
        where id = (v_record->>'id')::uuid;

        v_relationships_updated := v_relationships_updated + 1;

      exception when invalid_text_representation then
        -- 4. Insert new relationships when id is a temp_id
        raise log '4. Insert new relationships when id is a temp_id';

        v_new_uuid := gen_random_uuid();
        v_temp_id_map := jsonb_set(v_temp_id_map, array[v_record->>'id'], to_jsonb(v_new_uuid));
      
        if v_temp_id_map ? (v_record->>'source') then
          v_source_id := (v_temp_id_map->>(v_record->>'source'))::uuid;
        else
          v_source_id := (v_record->>'source')::uuid;
        end if;

        if v_temp_id_map ? (v_record->>'target') then
          v_target_id := (v_temp_id_map->>(v_record->>'target'))::uuid;
        else
          v_target_id := (v_record->>'target')::uuid;
        end if;

        insert into public.kg_relationships (
          id, owner_id, relationship_type, source_entity_id, target_entity_id, valid_from, valid_to, encrypted_data, master_key_version
        )
        values (
          v_new_uuid, p_owner_id, v_record->>'type', v_source_id, v_target_id, v_record->>'valid_from', v_record->>'valid_to',
          public.encrypt_jsonb(coalesce(v_record->'data', '{}'::jsonb), v_master_key_version), v_master_key_version
        );
        
        v_relationships_added := v_relationships_added + 1;
      end;

    end loop;
  end if;

  -- 5. Insert attributions
  raise log '5. Insert attributions';

  for v_record in select * from jsonb_array_elements(p_attributions) loop
    for v_val in select * from jsonb_array_elements(v_record->'targets') loop
      
      if v_temp_id_map ? (v_val->>'target_id') then
        v_target_id := (v_temp_id_map->>(v_val->>'target_id'))::uuid;
      else
        v_target_id := (v_val->>'target_id')::uuid;
      end if;

      insert into public.kg_document_attributions (
        document_id, target_type, target_id, role
      ) values (
        (v_record->>'document_id')::uuid, v_val->>'target_type', v_target_id, v_val->>'role'
      );
      
      v_attributions_added := v_attributions_added + 1;
    end loop;
  end loop;

  -- 6. Audit Logging
  raise log '6. Audit Logging';

  insert into public.kg_mutation_log (
    owner_id, mutations_applied, raw_llm_response, documents_in_batch
  ) values (
    p_owner_id, p_mutations, p_raw_llm_response, to_jsonb(p_document_ids)
  );

  -- 7. Finalize batch synchronization (Option 3 Postgres Batching)
  raise log '7. Finalize batch synchronization';
  
  update public.documents
  set 
    kg_sync_status = 'synced',
    updated_at = now()
  where id = any(p_document_ids);

  return jsonb_build_object(
    'entities_added', v_entities_added,
    'entities_updated', v_entities_updated,
    'relationships_added', v_relationships_added,
    'relationships_updated', v_relationships_updated,
    'relationships_closed', v_relationships_closed,
    'attributions_added', v_attributions_added
  );
end;
$$;

revoke all on function worker_kg_apply_mutations(uuid, jsonb, jsonb, uuid[], jsonb) from public, anon, authenticated;
grant execute on function worker_kg_apply_mutations(uuid, jsonb, jsonb, uuid[], jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- worker_kg_log_batch_error: Handle failed KG parsing runs
-- -----------------------------------------------------------------------------
create or replace function worker_kg_log_batch_error(
  p_owner_id uuid,
  p_document_ids uuid[],
  p_error_message text
)
returns boolean
language plpgsql
security definer
as $$
begin
  insert into public.kg_mutation_log (
    owner_id, mutations_applied, raw_llm_response, documents_in_batch
  ) values (
    p_owner_id, null, jsonb_build_object('error', p_error_message), to_jsonb(p_document_ids)
  );
  
  -- Revert documents to pending so they can be retried
  update public.documents
  set 
    kg_sync_status = 'pending',
    updated_at = now()
  where id = any(p_document_ids);

  return true;
end;
$$;

revoke all on function worker_kg_log_batch_error(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function worker_kg_log_batch_error(uuid, uuid[], text) to service_role;

-- -----------------------------------------------------------------------------
-- worker_kg_count_pending_documents: Count remaining documents for an owner
-- -----------------------------------------------------------------------------
create or replace function worker_kg_count_pending_documents(
  p_owner_id uuid
)
returns integer
language sql
security definer
stable
as $$
  select count(*)::integer
  from public.documents
  where owner_id = p_owner_id
    and kg_sync_status = 'pending'
    and deleted_at is null;
$$;

revoke all on function worker_kg_count_pending_documents(uuid) from public, anon, authenticated;
grant execute on function worker_kg_count_pending_documents(uuid) to service_role;
