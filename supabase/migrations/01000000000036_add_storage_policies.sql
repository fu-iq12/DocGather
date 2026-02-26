-- =============================================================================
-- Phase 3: Storage Bucket Policies
-- @see architecture/documents-checklist.md
-- =============================================================================
-- Purpose: Secure access to documents and thumbnails storage buckets.
-- Design:
--   - documents bucket: service_role only (all access via Edge Functions)

-- =============================================================================

-- -----------------------------------------------------------------------------
-- Documents bucket policies (service_role only)
-- -----------------------------------------------------------------------------
-- All file operations go through Edge Functions which use service_role.
-- No direct client access allowed for security.

create policy "Service role can read documents bucket"
  on storage.objects
  for select
  to service_role
  using (bucket_id = 'documents');

create policy "Service role can insert documents bucket"
  on storage.objects
  for insert
  to service_role
  with check (bucket_id = 'documents');

create policy "Service role can update documents bucket"
  on storage.objects
  for update
  to service_role
  using (bucket_id = 'documents')
  with check (bucket_id = 'documents');

create policy "Service role can delete documents bucket"
  on storage.objects
  for delete
  to service_role
  using (bucket_id = 'documents');



