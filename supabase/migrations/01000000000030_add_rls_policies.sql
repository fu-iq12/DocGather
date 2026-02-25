-- =============================================================================
-- Phase 3: Security Layer (Row Level Security)- @documents-checklist.md
-- =============================================================================
-- Purpose: Enable RLS on all document tables and create access policies.
-- Policy design:
--   - documents: Owner can CRUD their own docs (with soft delete restriction)
--   - document_files: Owner can SELECT via join, service_role for writes
--   - document_private: service_role only (encrypted PII)
--   - cloud_sources: Owner can SELECT via join, service_role for writes
--   - document_access_log: service_role insert only, owner can SELECT own logs
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enable RLS on all tables
-- -----------------------------------------------------------------------------

alter table public.documents enable row level security;
alter table public.document_files enable row level security;
alter table public.document_private enable row level security;
alter table public.cloud_sources enable row level security;
alter table public.document_access_log enable row level security;

-- =============================================================================
-- documents policies
-- =============================================================================
-- Owner-based access with soft delete filtering

-- SELECT: Owner can read their own non-deleted documents
create policy "Owner can select own documents"
  on public.documents
  for select
  to authenticated
  using (
    (select auth.uid()) = owner_id
    and deleted_at is null
  );

-- INSERT: Owner can create documents for themselves
create policy "Owner can insert own documents"
  on public.documents
  for insert
  to authenticated
  with check (
    (select auth.uid()) = owner_id
  );

-- UPDATE: Owner can update their own documents
create policy "Owner can update own documents"
  on public.documents
  for update
  to authenticated
  using (
    (select auth.uid()) = owner_id
    and deleted_at is null
  )
  with check (
    (select auth.uid()) = owner_id
  );

-- DELETE: Prevent hard deletes - use soft delete via UPDATE deleted_at
-- No DELETE policy = no hard deletes allowed for authenticated users

-- =============================================================================
-- document_files policies
-- =============================================================================
-- Owner can read file metadata; writes go through Edge Functions (service_role)

-- SELECT: Owner can read their own document files
create policy "Owner can select own document files"
  on public.document_files
  for select
  to authenticated
  using (
    document_id in (
      select id from public.documents
      where owner_id = (select auth.uid())
        and deleted_at is null
    )
  );

-- INSERT: service_role only (Edge Functions)
create policy "Service role can insert document files"
  on public.document_files
  for insert
  to service_role
  with check (true);

-- UPDATE: service_role only
create policy "Service role can update document files"
  on public.document_files
  for update
  to service_role
  using (true)
  with check (true);

-- DELETE: service_role only
create policy "Service role can delete document files"
  on public.document_files
  for delete
  to service_role
  using (true);

-- =============================================================================
-- document_private policies
-- =============================================================================
-- STRICTLY service_role only - contains encrypted PII

create policy "Service role can select document private"
  on public.document_private
  for select
  to service_role
  using (true);

create policy "Service role can insert document private"
  on public.document_private
  for insert
  to service_role
  with check (true);

create policy "Service role can update document private"
  on public.document_private
  for update
  to service_role
  using (true)
  with check (true);

create policy "Service role can delete document private"
  on public.document_private
  for delete
  to service_role
  using (true);

-- =============================================================================
-- cloud_sources policies
-- =============================================================================
-- Owner can read via document chain; writes through Edge Functions

-- SELECT: Owner can read cloud sources for their document files
create policy "Owner can select own cloud sources"
  on public.cloud_sources
  for select
  to authenticated
  using (
    document_file_id in (
      select df.id from public.document_files df
      inner join public.documents d on df.document_id = d.id
      where d.owner_id = (select auth.uid())
        and d.deleted_at is null
    )
  );

-- INSERT: service_role only
create policy "Service role can insert cloud sources"
  on public.cloud_sources
  for insert
  to service_role
  with check (true);

-- UPDATE: service_role only
create policy "Service role can update cloud sources"
  on public.cloud_sources
  for update
  to service_role
  using (true)
  with check (true);

-- DELETE: service_role only
create policy "Service role can delete cloud sources"
  on public.cloud_sources
  for delete
  to service_role
  using (true);

-- =============================================================================
-- document_access_log policies
-- =============================================================================
-- Insert via service_role (Edge Functions log access); owner can read own logs

-- SELECT: Owner can read access logs for their own documents
create policy "Owner can select own access logs"
  on public.document_access_log
  for select
  to authenticated
  using (
    document_id in (
      select id from public.documents
      where owner_id = (select auth.uid())
        -- Note: Include deleted docs in log access for GDPR audit trail
    )
  );

-- INSERT: service_role only (logs created by Edge Functions)
create policy "Service role can insert access logs"
  on public.document_access_log
  for insert
  to service_role
  with check (true);

-- No UPDATE or DELETE policies - audit logs are immutable
