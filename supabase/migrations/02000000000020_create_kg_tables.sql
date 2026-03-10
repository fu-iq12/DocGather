-- =============================================================================
-- Phase 5.1: Knowledge Graph Foundation
-- =============================================================================
-- Creates tracking tables for entities, relationships, document attributions
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Table: kg_entities
-- -----------------------------------------------------------------------------
create table public.kg_entities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,

  entity_type text not null
    check (entity_type in ('individual', 'business', 'non_profit', 'administration')),

  is_owner boolean default false,

  encrypted_data bytea,
  master_key_version int not null default 1,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

create index idx_kg_entities_owner on kg_entities(owner_id) where deleted_at is null;
create unique index idx_kg_entities_single_owner on kg_entities(owner_id) where is_owner = true and deleted_at is null;

-- -----------------------------------------------------------------------------
-- Table: kg_relationships
-- -----------------------------------------------------------------------------
create table public.kg_relationships (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  
  relationship_type text not null,
  
  source_entity_id uuid not null references public.kg_entities(id) on delete cascade,
  target_entity_id uuid not null references public.kg_entities(id) on delete cascade,

  valid_from date,
  valid_to date,

  encrypted_data bytea,
  master_key_version int not null default 1,

  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

create index idx_kg_relationships_owner on kg_relationships(owner_id) where deleted_at is null;
create index idx_kg_relationships_source on kg_relationships(source_entity_id);
create index idx_kg_relationships_target on kg_relationships(target_entity_id);

-- -----------------------------------------------------------------------------
-- Table: kg_document_attributions
-- -----------------------------------------------------------------------------
create table public.kg_document_attributions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  
  target_type text not null
    check (target_type in ('entity', 'relationship')),
  target_id uuid not null,
  
  attribution_confidence float,
  role text,

  created_at timestamptz default now()
);

create index idx_kg_attributions_document on kg_document_attributions(document_id);
create index idx_kg_attributions_target on kg_document_attributions(target_type, target_id);

-- -----------------------------------------------------------------------------
-- Table: kg_confirmed_overrides
-- -----------------------------------------------------------------------------
create table public.kg_confirmed_overrides (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,

  target_type text not null
    check (target_type in ('entity', 'relationship')),
  target_id uuid not null,
  
  json_path text not null,
  
  encrypted_value bytea,
  master_key_version int not null default 1,

  source text not null
    check (source in ('manual_input', 'user_verified')),

  confirmed_at timestamptz default now()
);

-- Maximum 1 override per target per path
create unique index idx_kg_overrides_unique on kg_confirmed_overrides(target_type, target_id, json_path);

-- -----------------------------------------------------------------------------
-- Table: kg_mutation_log
-- -----------------------------------------------------------------------------
create table public.kg_mutation_log (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  
  mutations_applied jsonb,
  raw_llm_response jsonb,
  documents_in_batch jsonb not null,

  created_at timestamptz default now()
);

create index idx_kg_mutation_log_owner on kg_mutation_log(owner_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Setup existing triggers for kg updated_at fields
-- -----------------------------------------------------------------------------
create trigger kg_entities_updated_at
  before update on kg_entities
  for each row execute function update_updated_at_column();

create trigger kg_relationships_updated_at
  before update on kg_relationships
  for each row execute function update_updated_at_column();
