-- =============================================================================
-- Phase 5.2: Knowledge Graph Decoded Views
-- =============================================================================

-- -----------------------------------------------------------------------------
-- View: kg_entities_decoded
-- -----------------------------------------------------------------------------
create or replace view public.kg_entities_decoded with (security_invoker = on) as
select
  id,
  owner_id,
  entity_type,
  is_owner,
  case 
    when encrypted_data is not null then public.decrypt_jsonb(encrypted_data, master_key_version)
    else null
  end as data,
  master_key_version,
  created_at,
  updated_at,
  deleted_at
from
  public.kg_entities;

revoke all on public.kg_entities_decoded from public, anon, authenticated;
grant select on public.kg_entities_decoded to service_role, postgres;


-- -----------------------------------------------------------------------------
-- View: kg_relationships_decoded
-- -----------------------------------------------------------------------------
create or replace view public.kg_relationships_decoded with (security_invoker = on) as
select
  id,
  owner_id,
  relationship_type,
  source_entity_id,
  target_entity_id,
  valid_from,
  valid_to,
  case 
    when encrypted_data is not null then public.decrypt_jsonb(encrypted_data, master_key_version)
    else null
  end as data,
  master_key_version,
  created_at,
  updated_at,
  deleted_at
from
  public.kg_relationships;

revoke all on public.kg_relationships_decoded from public, anon, authenticated;
grant select on public.kg_relationships_decoded to service_role, postgres;


-- -----------------------------------------------------------------------------
-- View: kg_confirmed_overrides_decoded
-- -----------------------------------------------------------------------------
create or replace view public.kg_confirmed_overrides_decoded with (security_invoker = on) as
select
  id,
  owner_id,
  target_type,
  target_id,
  json_path,
  case 
    when encrypted_value is not null then public.decrypt_jsonb(encrypted_value, master_key_version)
    else null
  end as confirmed_value,
  master_key_version,
  source,
  confirmed_at
from
  public.kg_confirmed_overrides;

revoke all on public.kg_confirmed_overrides_decoded from public, anon, authenticated;
grant select on public.kg_confirmed_overrides_decoded to service_role, postgres;
