-- =============================================================================
-- Phase 1: Database Foundation- @documents-checklist.md
-- =============================================================================
-- Creates core tables for document management with GDPR-compliant soft delete,
-- envelope encryption support, and audit logging.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Table: documents - Main Document Registry
-- -----------------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  -- Note: Identity associations are in document_identities table (M:N relationship, future phase)

  -- Classification
  document_type text, -- 'payslip', 'bank_statement', 'passport', etc.
  document_subtype text, -- More specific categorization

  -- Lifecycle Status
  status text not null default 'uploaded'
    check (status in ('uploaded', 'queued', 'processing', 'processed', 'errored', 'archived', 'deleted', 'rejected')),

  -- Processing Pipeline Tracking
  process_status text default 'pending'
    check (process_status in ('pending', 'converting', 'pre_analyzing', 'splitting', 'scaling', 'pre_filtering', 'extracting', 'classifying', 'normalizing', 'completed', 'failed', 'rejected')),
  process_history jsonb default '[]'::jsonb,

  -- Queue Priority
  priority_score float default 0.0, -- Higher = process first

  -- Validity & Dates
  document_date date, -- Date on the document itself
  valid_from date,
  valid_until date, -- For expiring documents (ID cards, etc.)

  -- Confidence & Quality
  extraction_confidence float,

  -- Parent-child lineage (PDF splitting)
  parent_document_id uuid references public.documents(id) on delete cascade,
  page_range jsonb, -- { "pages": [2], "type": "top_half" }

  -- Billing Tracking
  llm_billing jsonb default '{"prompt_tokens": 0, "completion_tokens": 0, "pages": 0, "cost": 0}'::jsonb,

  -- Timestamps
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz -- Soft delete for GDPR
);

-- Critical index for queue processing
create index idx_documents_queue on documents(status, priority_score desc)
  where status = 'queued' and deleted_at is null;

-- Index for owner lookups
create index idx_documents_owner on documents(owner_id) 
  where deleted_at is null;

-- Index for looking up children of a parent
create index idx_documents_parent on documents(parent_document_id)
  where parent_document_id is not null;

-- -----------------------------------------------------------------------------
-- Table: document_files - File Storage References
-- -----------------------------------------------------------------------------
create table public.document_files (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,

  -- File Role
  file_role text not null default 'original'
    check (file_role in (
      'original',           -- Source file as uploaded
      'converted_pdf',      -- Format conversion for processing

      'llm_optimized',      -- Scaled/compressed for LLM vision
      'extracted_text',     -- OCR output
      'redacted'            -- PII-redacted version for sharing
    )),

  -- Storage
  storage_path text not null, -- Path in Supabase Storage
  mime_type text not null, -- 'application/pdf', 'image/jpeg', etc.
  file_size bigint,

  -- Deduplication & Change Detection
  content_hash bytea not null, -- SHA-256 of file content (computed BEFORE encryption)

  -- Envelope Encryption
  encrypted_data_key bytea not null, -- DEK encrypted with master key
  master_key_version int not null default 1,

  -- Metadata
  width int, -- For images
  height int,
  page_count int, -- For PDFs

  created_at timestamptz default now(),
  deleted_at timestamptz -- Soft delete for file version updates
);

-- Deduplication index (unique per owner's content + role)
create unique index idx_document_files_hash on document_files(content_hash, file_role)
  where deleted_at is null;

-- Unique per document + role (required for upsert ON CONFLICT)
create unique index idx_document_files_doc_role on document_files(document_id, file_role);

-- -----------------------------------------------------------------------------
-- Table: document_private - Encrypted PII Storage
-- -----------------------------------------------------------------------------
create table public.document_private (
  document_id uuid primary key references public.documents(id) on delete cascade,

  -- Encrypted Blobs (Tier A+B data)
  encrypted_metadata bytea, -- Encrypted JSON: filenames, dates
  encrypted_extracted_data bytea, -- Encrypted JSON: full extraction results
  master_key_version int not null default 1,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- -----------------------------------------------------------------------------
-- Table: cloud_sources - Cloud Source Tracking
-- -----------------------------------------------------------------------------
create table public.cloud_sources (
  id uuid primary key default gen_random_uuid(),
  document_file_id uuid not null references public.document_files(id) on delete cascade,

  -- Source Type (cloud sources only)
  source_type text not null
    check (source_type in (
      'google_drive',
      'onedrive',
      'dropbox',
      'gmail',
      'outlook'
    )),

  -- Cloud Source Tracking
  cloud_file_id text not null, -- Provider's unique file ID (survives renames)
  cloud_etag text, -- ETag or similar content version token
  cloud_revision text, -- Revision ID if available
  cloud_modified_at bigint, -- Provider's modification timestamp (unix ms)

  -- Filename (hashed for PII protection)
  filename_hash bytea not null, -- SHA-256 of original filename

  -- Rate Limiting
  last_processed_at timestamptz, -- When we last ran processing pipeline
  next_allowed_process_at timestamptz default now(), -- Rate limit
  process_count int default 0, -- How many times we've processed this source

  -- Sync State
  last_synced_at timestamptz default now(),
  sync_status text default 'synced'
    check (sync_status in ('synced', 'changed', 'deleted', 'conflict')),

  created_at timestamptz default now()
);

-- Lookup by cloud ID (unique per provider)
create unique index idx_cloud_sources_cloud on cloud_sources(source_type, cloud_file_id);

-- Lookup by document file
create index idx_cloud_sources_file on cloud_sources(document_file_id);

-- Find sources ready for reprocessing
create index idx_cloud_sources_pending on cloud_sources(sync_status, next_allowed_process_at)
  where sync_status = 'changed';

-- -----------------------------------------------------------------------------
-- Table: document_access_log - Audit Trail
-- -----------------------------------------------------------------------------
-- IMPORTANT: No CASCADE on document FK - audit trail must survive document deletion
create table public.document_access_log (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id), -- NO CASCADE for audit integrity
  accessed_by uuid not null references auth.users(id),

  action text not null
    check (action in ('view', 'download', 'decrypt', 'share', 'export', 'delete')),
  purpose text, -- 'personal_use', 'application_xyz', 'third_party_share'

  -- Anonymized context (no PII in logs!)
  ip_hash text, -- Hashed IP, not raw
  user_agent_hash text,

  accessed_at timestamptz default now()
);

-- Query by document
create index idx_access_log_document on document_access_log(document_id, accessed_at desc);

-- Query by user
create index idx_access_log_user on document_access_log(accessed_by, accessed_at desc);

-- -----------------------------------------------------------------------------
-- Trigger: Update updated_at timestamp
-- -----------------------------------------------------------------------------
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger documents_updated_at
  before update on documents
  for each row execute function update_updated_at_column();

create trigger document_private_updated_at
  before update on document_private
  for each row execute function update_updated_at_column();

-- =============================================================================
-- Create a decoded view of document_private
-- =============================================================================

CREATE OR REPLACE VIEW public.document_private_decoded WITH (security_invoker = on) AS
SELECT
  document_id,
  CASE 
    WHEN encrypted_metadata IS NOT NULL THEN public.decrypt_jsonb(encrypted_metadata, master_key_version) 
    ELSE NULL 
  END as metadata,
  CASE 
    WHEN encrypted_extracted_data IS NOT NULL THEN public.decrypt_jsonb(encrypted_extracted_data, master_key_version) 
    ELSE NULL 
  END as extracted_data,
  master_key_version,
  created_at,
  updated_at
FROM
  public.document_private;

-- Revoke all access by default
REVOKE ALL ON public.document_private_decoded FROM PUBLIC;
REVOKE ALL ON public.document_private_decoded FROM anon;
REVOKE ALL ON public.document_private_decoded FROM authenticated;

-- Grant select only to service_role (and postgres)
GRANT SELECT ON public.document_private_decoded TO service_role;
GRANT SELECT ON public.document_private_decoded TO postgres;
