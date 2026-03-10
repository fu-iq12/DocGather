-- =============================================================================
-- Phase 5.5: Knowledge Graph User RPC Functions
-- =============================================================================

-- -----------------------------------------------------------------------------
-- user_kg_confirm_field: User confirms or manually inputs a field
-- -----------------------------------------------------------------------------
create or replace function user_kg_confirm_field(
  p_target_type text,
  p_target_id uuid,
  p_json_path text,
  p_value jsonb
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
  v_master_key_version int;
  v_override_id uuid;
  v_has_access boolean;
  
  v_current_data jsonb;
  v_merged jsonb;
begin
  -- 1. Check Auth
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- 2. Check target exists and belongs to user
  if p_target_type = 'entity' then
    select exists(select 1 from public.kg_entities where id = p_target_id and owner_id = v_user_id) into v_has_access;
  elsif p_target_type = 'relationship' then
    select exists(select 1 from public.kg_relationships where id = p_target_id and owner_id = v_user_id) into v_has_access;
  else
    raise exception 'Invalid target_type';
  end if;
  
  if not v_has_access then
    raise exception 'Target not found or access denied';
  end if;

  v_master_key_version := public.get_current_master_key_version();

  -- 3. Upsert into overrides
  insert into public.kg_confirmed_overrides (
    owner_id, target_type, target_id, json_path, encrypted_value, master_key_version, source
  ) values (
    v_user_id, p_target_type, p_target_id, p_json_path, public.encrypt_jsonb(p_value, v_master_key_version), v_master_key_version, 'manual_input'
  )
  on conflict (target_type, target_id, json_path) do update set
    encrypted_value = public.encrypt_jsonb(p_value, v_master_key_version),
    master_key_version = v_master_key_version,
    source = 'manual_input',
    confirmed_at = now()
  returning id into v_override_id;

  -- 4. Immediately patch the main graph so reads represent reality right away
  if p_target_type = 'entity' then
    select data into v_current_data from public.kg_entities_decoded where id = p_target_id;
    v_merged := jsonb_set(coalesce(v_current_data, '{}'::jsonb), array[replace(p_json_path, '$.', '')], p_value, true);
    
    update public.kg_entities 
    set encrypted_data = public.encrypt_jsonb(v_merged, v_master_key_version)
    where id = p_target_id;

  elsif p_target_type = 'relationship' then
    select data into v_current_data from public.kg_relationships_decoded where id = p_target_id;
    v_merged := jsonb_set(coalesce(v_current_data, '{}'::jsonb), array[replace(p_json_path, '$.', '')], p_value, true);
    
    update public.kg_relationships 
    set encrypted_data = public.encrypt_jsonb(v_merged, v_master_key_version)
    where id = p_target_id;
  end if;

  return v_override_id;
end;
$$;

revoke all on function user_kg_confirm_field(text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function user_kg_confirm_field(text, uuid, text, jsonb) to authenticated;
grant execute on function user_kg_confirm_field(text, uuid, text, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- user_kg_remove_override: Un-confirm a field
-- -----------------------------------------------------------------------------
create or replace function user_kg_remove_override(
  p_override_id uuid
)
returns boolean
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.kg_confirmed_overrides
  where id = p_override_id and owner_id = v_user_id;

  if not found then
    raise exception 'Override not found or access denied';
  end if;

  return true;
end;
$$;

revoke all on function user_kg_remove_override(uuid) from public, anon, authenticated;
grant execute on function user_kg_remove_override(uuid) to authenticated;
grant execute on function user_kg_remove_override(uuid) to service_role;
