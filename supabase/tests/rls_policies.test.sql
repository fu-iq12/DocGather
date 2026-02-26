-- =============================================================================
-- RLS Policy Validation Suite
-- Verifies tenant isolation and security boundaries for document artifacts
-- @see architecture/documents-checklist.md - "Database Row Level Security"
-- Run with: npm run test:rls
-- =============================================================================

-- Run in a transaction so we can rollback all test data
BEGIN;

-- -----------------------------------------------------------------------------
-- Setup: Create test users in auth.users (required for FK constraint)
-- -----------------------------------------------------------------------------
\echo ''
\echo '[Setup] Creating test users...'

INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, aud, role)
VALUES 
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'user_a@test.local', '', now(), '{}', '{}', now(), now(), 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'user_b@test.local', '', now(), '{}', '{}', now(), now(), 'authenticated', 'authenticated');

\echo '[Setup] Creating test documents...'

INSERT INTO public.documents (id, owner_id, document_type, status)
VALUES 
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'payslip', 'queued'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaab', '11111111-1111-1111-1111-111111111111', 'bank_statement', 'processed');

INSERT INTO public.documents (id, owner_id, document_type, status)
VALUES 
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'passport', 'queued');

INSERT INTO public.document_files (id, document_id, file_role, storage_path, mime_type, file_size, content_hash, encrypted_data_key, master_key_version)
VALUES 
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'original', '11111111-1111-1111-1111-111111111111/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/original.pdf', 'application/pdf', 1024, decode('abcdef', 'hex'), decode('0011223344556677', 'hex'), 1);

INSERT INTO public.document_private (document_id, encrypted_metadata, master_key_version)
VALUES 
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', decode('0011223344', 'hex'), 1);

\echo '[Setup] Test data created.'
\echo ''

-- =============================================================================
-- Test 1a: User A sees only their own documents (should be 2)
-- =============================================================================
\echo '--- Test 1a: User A document isolation ---'
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

SELECT CASE WHEN count(*) = 2 
  THEN 'PASS: User A sees 2 documents' 
  ELSE 'FAIL: User A sees ' || count(*) || ' (expected 2)' 
END AS result FROM public.documents;

RESET ROLE;

-- =============================================================================
-- Test 1b: User B sees only their own documents (should be 1)
-- =============================================================================
\echo '--- Test 1b: User B document isolation ---'
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

SELECT CASE WHEN count(*) = 1 
  THEN 'PASS: User B sees 1 document' 
  ELSE 'FAIL: User B sees ' || count(*) || ' (expected 1)' 
END AS result FROM public.documents;

RESET ROLE;

-- =============================================================================
-- Test 2: document_private is invisible to authenticated users
-- =============================================================================
\echo '--- Test 2: document_private isolation ---'
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

SELECT CASE WHEN count(*) = 0 
  THEN 'PASS: document_private invisible (0 rows)' 
  ELSE 'FAIL: document_private visible (' || count(*) || ' rows)' 
END AS result FROM public.document_private;

RESET ROLE;

-- =============================================================================
-- Test 3: Soft-deleted documents are hidden
-- =============================================================================
\echo '--- Test 3: Soft delete filtering ---'

-- Soft delete one document (as postgres)
UPDATE public.documents SET deleted_at = now() 
WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaab';

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

SELECT CASE WHEN count(*) = 1 
  THEN 'PASS: Soft-deleted doc hidden (1 visible)' 
  ELSE 'FAIL: User sees ' || count(*) || ' after soft delete (expected 1)' 
END AS result FROM public.documents;

RESET ROLE;

-- =============================================================================
-- Test 4a: Owner can read their document_files
-- =============================================================================
\echo '--- Test 4a: Owner can read document_files ---'
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

SELECT CASE WHEN count(*) = 1 
  THEN 'PASS: User A sees 1 document_file' 
  ELSE 'FAIL: User A sees ' || count(*) || ' document_files (expected 1)' 
END AS result FROM public.document_files;

RESET ROLE;

-- =============================================================================
-- Test 4b: User B cannot see User A's document_files
-- =============================================================================
\echo '--- Test 4b: Cross-user document_files isolation ---'
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

SELECT CASE WHEN count(*) = 0 
  THEN 'PASS: User B cannot see User A files (0 rows)' 
  ELSE 'FAIL: User B sees ' || count(*) || ' files (expected 0)' 
END AS result FROM public.document_files;

RESET ROLE;

-- =============================================================================
-- Cleanup via ROLLBACK
-- =============================================================================
\echo ''
\echo 'Rolling back all test data...'

ROLLBACK;

\echo ''
\echo '============================================='
\echo 'All RLS tests completed!'
\echo '============================================='
