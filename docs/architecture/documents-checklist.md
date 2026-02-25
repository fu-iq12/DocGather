# Documents Architecture - Implementation Checklist

> **Reference**: [documents.md](./documents.md)  
> **Last Updated**: 2026-01-29  
> **Status**: Ready for Implementation

This checklist provides exhaustive implementation tasks, grouped into logical phases, with test protocols and subtleties to watch for.

---

## Phase Overview

| Phase | Focus Area                    | Dependencies | Estimated Effort |
| ----- | ----------------------------- | ------------ | ---------------- |
| **1** | Database Foundation           | None         | 2-3 days         |
| **2** | Storage & Encryption          | Phase 1      | 3-4 days         |
| **3** | Security Layer (RLS)          | Phases 1-2   | 2-3 days         |
| **4** | Edge Functions - Core         | Phases 1-3   | 4-5 days         |
| **5** | Change Detection & Cloud Sync | Phases 1-4   | 3-4 days         |
| **6** | Priority & Queue Management   | Phases 1-4   | 2-3 days         |
| **7** | GDPR Compliance               | Phases 1-4   | 2-3 days         |
| **8** | Background Jobs & Maintenance | All          | 2-3 days         |

---

## Phase 1: Database Foundation

### 1.1 Core Tables

- [x] **Create `documents` table** ✅
  - [x] All columns as spec'd (id, owner_id, document_type, etc.) — Note: identity linking is M:N via future `document_identities` table
  - [x] CHECK constraint on `status` enum values
  - [x] CHECK constraint on `process_status` enum values
  - [x] Default values for `status`, `process_status`, `priority_score`, `process_history`
  - [x] `deleted_at` for soft delete

- [x] **Create `document_files` table** ✅
  - [x] Foreign key to `documents` with `ON DELETE CASCADE`
  - [x] CHECK constraint on `file_role` enum values
  - [x] `content_hash` as `bytea NOT NULL`
  - [x] `encrypted_data_key` and `master_key_version` for envelope encryption
  - [x] `deleted_at` for version updates (soft delete)

- [x] **Create `document_private` table** ✅
  - [x] Primary key references `documents(id)` with `ON DELETE CASCADE`
  - [x] `encrypted_metadata`, `encrypted_extracted_data` as `bytea`

- [x] **Create `cloud_sources` table** ✅
  - [x] Foreign key to `document_files` with `ON DELETE CASCADE`
  - [x] CHECK constraint on `source_type` (cloud providers only)
  - [x] `cloud_file_id` as `NOT NULL` with unique constraint per provider
  - [x] `filename_hash` as `bytea NOT NULL` (hashed for PII)
  - [x] Rate limiting fields: `last_processed_at`, `next_allowed_process_at`, `process_count`
  - [x] CHECK constraint on `sync_status` enum values

- [x] **Create `document_access_log` table** ✅
  - [x] Foreign key to `documents(id)` (NO CASCADE - audit trail integrity)
  - [x] CHECK constraint on `action` enum values
  - [x] `ip_hash`, `user_agent_hash` (never raw PII)

### 1.2 Indexes

- [x] **`documents` indexes** ✅
  - [x] `idx_documents_queue` on `(status, priority_score DESC)` WHERE `status = 'queued' AND deleted_at IS NULL`
  - [x] `idx_documents_owner` on `(owner_id)` WHERE `deleted_at IS NULL`

- [x] **`document_files` indexes** ✅
  - [x] `idx_document_files_hash` UNIQUE on `(content_hash, file_role)`
  - [x] `idx_document_files_role` on `(document_id, file_role)`

- [x] **`cloud_sources` indexes** ✅
  - [x] `idx_cloud_sources_cloud` UNIQUE on `(source_type, cloud_file_id)`
  - [x] `idx_cloud_sources_file` on `(document_file_id)`
  - [x] `idx_cloud_sources_pending` on `(sync_status, next_allowed_process_at)` WHERE `sync_status = 'changed'`

- [x] **`document_access_log` indexes** ✅
  - [x] `idx_access_log_document` on `(document_id, accessed_at DESC)`
  - [x] `idx_access_log_user` on `(accessed_by, accessed_at DESC)`

### 1.3 Test Protocol - Phase 1

```sql
-- T1.1: Verify table creation
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('documents', 'document_files', 'document_private', 'cloud_sources', 'document_access_log');

-- T1.2: Verify CHECK constraints work
INSERT INTO documents (owner_id, document_type, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'test', 'invalid_status');
-- Expected: CHECK constraint violation

-- T1.3: Verify CASCADE deletes
-- Insert document, insert document_files, delete document → document_files should be deleted

-- T1.4: Verify unique constraints
-- Insert two document_files with same content_hash + file_role → should fail

-- T1.5: Verify index usage
EXPLAIN ANALYZE SELECT * FROM documents WHERE status = 'queued' AND deleted_at IS NULL ORDER BY priority_score DESC LIMIT 10;
-- Expected: Uses idx_documents_queue
```

### 1.4 Subtleties & Gotchas

> [!WARNING]
> **`content_hash` must be computed BEFORE encryption**  
> If you hash the encrypted content, deduplication will fail (same file = different encrypted blobs).

> [!WARNING]
> **`document_access_log` does NOT cascade on document delete**  
> Audit trail must survive for GDPR compliance. Reference integrity enforced but rows kept.

> [!NOTE]
> **`cloud_sources` is cloud-only**  
> Direct uploads and local sync don't create entries here. Content hash is sufficient for deduplication.

---

## Phase 2: Storage & Encryption

### 2.1 Storage Buckets

- [x] **Create `documents` bucket** ✅ (configured in config.toml)
  - [x] `public = false`
  - [x] `file_size_limit = 50MiB`
  - [x] No MIME type restrictions (decoding/conversion handled at processing time)

### 2.2 Storage Path Convention ✅

- [x] **Verify path structure implementation**
  - [x] Documents: `documents/{owner_id}/{document_id}/original.{ext}`
  - [x] Converted: `documents/{owner_id}/{document_id}/converted.pdf`
  - [x] LLM optimized: `documents/{owner_id}/{document_id}/llm_optimized.webp`

### 2.3 Encryption Implementation

#### Vault Setup (Master Key Management)

- [x] **Enable extensions** ✅
  - [x] Enable `supabase_vault` extension
  - [x] Enable `pgcrypto` extension

- [x] **Create master key in Vault** ✅ (via seed.ts)
  - [x] Generate 256-bit key: `openssl rand -base64 32`
  - [x] Store in Vault as `DOCGATHER_MASTER_KEY_V1`
  - [x] Document key version tracking process

#### PostgreSQL Encryption Functions

- [x] **DEK encryption/decryption** ✅
  - [x] `encrypt_dek(p_dek, p_master_key_version)` — Encrypt DEK with master key
  - [x] `decrypt_dek(p_encrypted_dek, p_master_key_version)` — Decrypt DEK with master key

- [x] **Metadata encryption/decryption** ✅
  - [x] `encrypt_metadata(p_metadata, p_master_key_version)` — Encrypt JSON metadata
  - [x] `decrypt_metadata(p_encrypted, p_master_key_version)` — Decrypt JSON metadata

- [x] **Security** ✅
  - [x] All functions marked `SECURITY DEFINER`
  - [x] Restrict `vault.decrypted_secrets` access to `service_role`

#### Edge Function Encryption (Files)

- [x] **Crypto utilities** (`_shared/crypto.ts`) ✅
  - [x] `generateDEK()` — Generate 256-bit random key
  - [x] `encryptFile(data, dek)` — AES-256-GCM encryption
  - [x] `decryptFile(ciphertext, dek, iv)` — AES-256-GCM decryption
  - [x] `sha256(data)` — Content hash for deduplication

- [x] **Storage utilities** (`_shared/storage.ts`) ✅
  - [x] `buildDocumentPath(ownerId, documentId, role, ext)`

### 2.4 Test Protocol - Phase 2

### 2.4 Test Protocol - Phase 2 ✅

Tests implemented using Deno's built-in test runner.

**Run all tests:**

```bash
npm run test
```

**Test files:**

- `supabase/functions/_shared/crypto.test.ts` (9 tests)
- `supabase/functions/_shared/storage.test.ts` (11 tests)

**Coverage:**

- [x] DEK generation (32-byte, unique keys)
- [x] Encryption/decryption round-trip
- [x] SHA-256 hash consistency
- [x] Base64/Hex encoding
- [x] Storage path building
- [x] Path extraction
- [x] Parameter validation

### 2.5 Subtleties & Gotchas

> [!CAUTION]
> **DEK must be unique per document, not per file**  
> All file derivatives (original, thumbnail, etc.) for the same document can share the DEK, but each document needs its own DEK.

> [!WARNING]
> **GCM nonces must never repeat**  
> Use a combination of document_id + file_role as part of nonce derivation, or generate random nonce and store it.

> [!NOTE]
> **Streaming encryption for large files**  
> For files > 10MB, use streaming encryption to avoid memory issues.

---

## Phase 3: Security Layer (RLS) ✅

### 3.1 Enable RLS

- [x] `ALTER TABLE documents ENABLE ROW LEVEL SECURITY`
- [x] `ALTER TABLE document_files ENABLE ROW LEVEL SECURITY`
- [x] `ALTER TABLE document_private ENABLE ROW LEVEL SECURITY`
- [x] `ALTER TABLE cloud_sources ENABLE ROW LEVEL SECURITY`
- [x] `ALTER TABLE document_access_log ENABLE ROW LEVEL SECURITY`

### 3.2 `documents` Policies ✅

- [x] **Select**: Owner can read own documents (WHERE `deleted_at IS NULL`)
- [x] **Insert**: Owner can create (WITH CHECK `auth.uid() = owner_id`)
- [x] **Update**: Owner can update own documents
- [x] **Soft Delete**: Handled via UPDATE policy (no hard DELETE allowed)

### 3.3 `document_files` Policies ✅

- [x] **Select**: Owner can read file metadata (via documents subquery)
- [x] **Insert**: `service_role` only (files created via Edge Functions)
- [x] **Update/Delete**: `service_role` only

### 3.4 `document_private` Policies ✅

- [x] **All operations**: `service_role` only (Edge Functions manage encrypted data)

### 3.5 `cloud_sources` Policies ✅

- [x] **Select**: Owner can read (via document_files → documents join)
- [x] **Insert/Update/Delete**: `service_role` only

### 3.6 Storage Policies ✅

- [x] **`documents` bucket**: `service_role` only (all access via Edge Functions)

### 3.7 Test Protocol - Phase 3 ✅

Verification complete:

- RLS enabled on all 5 tables
- 17 policies on public tables
- 8 policies on storage.objects

### 3.8 Subtleties & Gotchas

> [!CAUTION]
> **Never expose `document_private` to clients**  
> All access must go through Edge Functions. Even SELECT policies should require `service_role`.

> [!WARNING]
> **JOIN-based policies can be slow**  
> For `document_files` SELECT, the join to `documents` for owner check adds overhead. Consider caching owner_id in document_files if performance is an issue.

> [!IMPORTANT]
> **Test with multiple users**  
> RLS bugs often only appear in multi-tenant scenarios. Always test cross-user access attempts.

---

## Phase 4: Edge Functions - Core

### 4.1 `upload-document` ✅

- [x] **Input validation**
  - [x] Validate file size against bucket limit
  - [x] Validate MIME type against allowed list (magic bytes detection)
  - [x] Authenticate user

- [x] **Deduplication check**
  - [x] Calculate SHA-256 hash of file content
  - [x] Query existing files by content_hash
  - [x] If duplicate found, add source and return existing document_id

- [x] **Encryption**
  - [x] Generate DEK (32 bytes random)
  - [x] Encrypt file with AES-256-GCM
  - [x] Encrypt DEK with current Master Key (via `encrypt_dek` RPC)
  - [x] Track master_key_version

- [x] **Storage**
  - [x] Upload encrypted file to `documents/{owner_id}/{document_id}/original.{ext}`
  - [x] Store file metadata in `document_files`

- [x] **Database records**
  - [x] Insert `documents` row with initial status
  - [x] Insert `document_files` row
  - [x] Insert `document_private` row with encrypted source metadata

- [ ] **Priority calculation** (deferred to worker)
  - [ ] Initial `priority_score` set to 0
  - [ ] Worker recalculates after processing

### 4.2 `get-document` ✅

- [x] **Authorization**
  - [x] Verify ownership via RLS (user-scoped client)
  - [x] Verify document not deleted

- [x] **Decryption**
  - [x] Get `encrypted_data_key` and `master_key_version`
  - [x] Decrypt DEK with `decrypt_dek` RPC
  - [x] Fetch encrypted file from storage
  - [x] Decrypt file with DEK (AES-GCM)

- [x] **Access logging**
  - [x] Insert row into `document_access_log`
  - [x] Hash IP and User-Agent before storing (SHA-256)

- [x] **Response**
  - [x] Stream decrypted content directly
  - [x] Set proper `Content-Type`, `Content-Disposition`, `Cache-Control`

### 4.3 Worker Integration ✅

> Heavy processing (thumbnails, summaries, extraction) moved to **[processing-workers.md](processing-workers.md)**
> This section covers Supabase-side integration for fly.io workers.

- [x] **Queue trigger endpoint**
  - [x] `queue-job` Edge Function to add jobs to BullMQ
  - [x] Called after successful upload
  - [x] Returns job ID for tracking

- [x] **Worker authentication**
  - [x] Service key stored in Fly.io secrets
  - [x] Worker secret for RPC validation (stored in Supabase Vault + Fly.io)

- [x] **Status webhook/polling**
  - [x] `get-job-status` Edge Function
  - [x] Returns processing status and progress

### 4.4 Worker Write-back RPC Functions ✅

> [!NOTE]
> All RPC functions validate `FLY_WORKER_SECRET` from Vault before allowing updates.
> Workers pass the secret as first parameter; invalid secrets raise an exception.

- [x] **`worker_update_document()`**

  ```sql
  -- Called by workers to update document after processing
  -- Validates FLY_WORKER_SECRET from Vault
  -- Updates: document_type, status, extraction_confidence
  ```

- [x] **`worker_update_document_private()`**

  ```sql
  -- Called by workers to update private data
  -- Updates: encrypted_extracted_data
  ```

- [x] **`worker_update_document_file()`**

  ```sql
  -- Called when worker creates converted file (e.g., PDF conversion)
  -- Inserts new document_files row with encrypted DEK
  ```

- [x] **`worker_mark_processing_complete()`**
  ```sql
  -- Atomically updates status and process_history
  -- Sets status = 'processed' or 'failed'
  ```

### 4.5 RPC Functions (Supabase-side) ✅

- [x] **`check_duplicate_file()`** — Deduplication check (returns existing document_id)
- [x] **`soft_delete_document()`** — Ownership check + soft delete with cascade

### 4.6 Job Orchestration ✅

- [x] **`upload-document` → `queue-job` call**
  - Invokes `queue-job` Edge Function after successful upload
  - Fire-and-forget (document saved regardless of queue-job success)

- [x] **`queue-job` Edge Function**
  - Accepts `document_id` and `source` parameters
  - Calculates priority via `get_job_priority()` RPC
  - Sends job to Fly.io worker **before** updating DB
  - On success: sets `status=queued`, `process_status=pending`
  - On failure: sets `process_status=errored`, appends error to `process_history`

### 4.7 Test Protocol - Phase 4 ✅

> **Test file:** `supabase/functions/phase4.test.ts`
> Run: `deno test --allow-all supabase/functions/phase4.test.ts`

- [x] T4.1: Deduplication check
- [x] T4.2: Encryption verification (plaintext not in storage)
- [x] T4.3: Storage path conventions
- [x] T4.4: Worker RPC rejects invalid secret
- [x] T4.5: Worker RPC updates with valid secret
- [x] T4.6: Soft delete cascades to files
- [x] T4.7: worker_mark_processing_complete appends history
- [x] T4.8: Failed processing records error

### 4.8 Subtleties & Gotchas

> [!CAUTION]
> **Worker service key scope**  
> Workers must use a tightly-scoped service key. Never give workers access to auth tables.

> [!WARNING]
> **Hash before encrypt, encrypt before store**  
> Order is critical: `original → hash → encrypt → store`. Never store unencrypted content.

> **Processing done externally**  
> OCR and extraction are handled by fly.io workers. See [processing-workers.md](processing-workers.md).

---

## Phase 5: Cloud Sync & Change Detection

> **Moved to [processing-workers.md](processing-workers.md)** — Phase W3
>
> Cloud sync operations run on fly.io workers due to:
>
> - Long-running API calls to cloud providers
> - Rate limiting and retry logic
> - Token refresh flows

**Supabase-side requirements:**

- [ ] **OAuth token storage**
  - [ ] Encrypted storage of OAuth refresh tokens
  - [ ] RPC function for workers to retrieve tokens

- [ ] **Cloud source tracking**
  - [ ] `cloud_sources` table (already in schema)
  - [ ] RPC function `worker_update_cloud_source()`

---

## Phase 6: Priority & Queue Management ✅

> **Simple 3-tier priority** — computed on Supabase, passed to BullMQ.

### 6.1 Priority Tiers ✅

| Source        | Priority    | Use Case                           |
| ------------- | ----------- | ---------------------------------- |
| `user_upload` | 1 (highest) | User is waiting for result         |
| `cloud_sync`  | 5 (medium)  | Background sync from cloud storage |
| `retry`       | 10 (lowest) | Failed job retry                   |

- [x] **`get_job_priority(p_source)` RPC**
  - `20260203010000_add_job_priority.sql`
  - Returns BullMQ priority (lower = higher priority)

- [x] **`queue-job` Edge Function**
  - Accepts `source` parameter (default: `user_upload`)
  - Calls `get_job_priority()` RPC
  - Includes `priority` in worker payload

### 6.2 Retry Mechanism ✅

> Migration: `01000000000065_add_retry_mechanism.sql`

- [x] **`app_config` table** — stores worker version
- [x] **`retry_errored_documents()` RPC**
  - Cron-triggered (pg_cron, hourly)
  - Re-queues docs with `process_status=errored`
  - Triggers on new worker deployment or 24h fallback
  - Max 3 retries per version
  - Uses pg_net to call `queue-job` Edge Function

---

## Phase 7: GDPR Compliance

### 7.1 Soft Delete

- [ ] **`soft_delete_document()` function**
  - [ ] Verify ownership
  - [ ] Set `deleted_at = now()`
  - [ ] Set `status = 'deleted'`
  - [ ] Log deletion in `document_access_log`

- [ ] **Immediate access revocation**
  - [ ] RLS policies exclude `deleted_at IS NOT NULL`
  - [ ] Storage policies respect deletion

### 7.2 Data Scrubbing Job

- [ ] **Phase 1: 7+ days - Delete files**
  - [ ] Delete from Supabase Storage
  - [ ] Delete `document_files` rows
  - [ ] Delete `document_private` rows
  - [ ] Delete `cloud_sources` rows

- [ ] **Phase 2: 30+ days - Anonymize documents**
  - [ ] Set `document_type = 'REDACTED'`
  - [ ] Null out: `document_subtype`, `document_date`, `valid_from`, `valid_until`, `extraction_confidence`
  - [ ] Set `process_history = '[]'`
  - [ ] Set `status = 'scrubbed'`

### 7.3 Data Export

- [ ] **`export_user_data()` function**
  - [ ] Verify caller is the user
  - [ ] Export all document metadata
  - [ ] Export all access logs
  - [ ] Return as JSON

### 7.4 Audit Trail

- [ ] **Access logging**
  - [ ] Log all document access (view, download, decrypt, share, export, delete)
  - [ ] Never store raw IP or User-Agent
  - [ ] Use SHA-256 hash of IP and User-Agent

- [ ] **Audit trail preservation**
  - [ ] `document_access_log` survives document deletion
  - [ ] Logs contain UUIDs only, no PII

### 7.5 Test Protocol - Phase 7

```sql
-- T7.1: Soft delete revokes access
BEGIN;
SELECT soft_delete_document('doc-uuid'); -- As owner
COMMIT;
-- As same user, SELECT * FROM documents WHERE id = 'doc-uuid' → 0 rows (RLS hides)

-- T7.2: Scrubbing timeline
-- Fast-forward: UPDATE documents SET deleted_at = now() - interval '8 days';
SELECT gdpr_scrub_deleted_documents();
-- Verify: document_files, document_private, cloud_sources deleted
-- Verify: documents still exists

-- T7.3: Anonymization
-- Fast-forward: UPDATE documents SET deleted_at = now() - interval '31 days';
SELECT gdpr_scrub_deleted_documents();
SELECT document_type, document_date FROM documents WHERE id = 'doc-uuid';
-- Expected: document_type = 'REDACTED', document_date = NULL

-- T7.4: Access log preservation
SELECT COUNT(*) FROM document_access_log WHERE document_id = 'doc-uuid';
-- Expected: > 0 (logs preserved)

-- T7.5: No PII in logs
SELECT ip_hash, user_agent_hash FROM document_access_log LIMIT 1;
-- Expected: Hashed values, not readable IPs/user-agents
```

### 7.6 Subtleties & Gotchas

> [!CAUTION]
> **7-day vs 30-day retention**  
> Files deleted at 7 days, metadata anonymized at 30 days. This allows recovery window while meeting GDPR 30-day deadline.

> [!IMPORTANT]
> **Access logs must NEVER cascade delete**  
> They're the proof of compliance. Use `ON DELETE SET NULL` or no cascade.

> [!WARNING]
> **Test with real deletion scenarios**  
> GDPR auditors may request proof. Document your test results.

---

## Phase 8: Background Jobs & Maintenance

### 8.1 Scheduled Jobs

- [ ] **GDPR scrubbing job** — Daily
  - [ ] Calls `gdpr_scrub_deleted_documents()`
  - [ ] Processes `storage_cleanup_queue`
  - [ ] Logs results

- [ ] **Orphan file cleanup** — Daily
  - [ ] Calls `cleanup_orphan_files()`
  - [ ] Deletes soft-deleted `document_files` older than 7 days

- [ ] **Priority recalculation** — Daily
  - [ ] Recalculates priority for all queued documents
  - [ ] Accounts for time decay

- [ ] **Cloud sync** — Configurable (hourly default)
  - [ ] Calls `sync-source` for each user's connected accounts
  - [ ] Respects rate limiting

### 8.2 Key Rotation

- [ ] **Deploy new master key**
  - [ ] Add version N+1 to Vault
  - [ ] Keep version N available for decryption

- [ ] **Background re-encryption**
  - [ ] Iterate through `document_files` with `master_key_version < N+1`
  - [ ] Decrypt DEK with old key, re-encrypt with new key
  - [ ] Update `master_key_version`
  - [ ] Same for `document_private`

- [ ] **Complete rotation**
  - [ ] Verify all rows migrated
  - [ ] Optionally revoke old key (after grace period)

### 8.3 Monitoring & Alerts

- [ ] **Queue depth** — Alert if > 1000 queued documents
- [ ] **Processing time** — Alert if document takes > 5 minutes
- [ ] **Error rate** — Alert if > 5% documents fail processing
- [ ] **Scrubbing job** — Alert if job fails
- [ ] **Key version** — Alert if old key versions still in use after rotation

### 8.4 Test Protocol - Phase 8

```typescript
// T8.1: GDPR job runs successfully
const result = await runGDPRScrubJob();
assert(result.files_deleted >= 0);
assert(result.documents_anonymized >= 0);

// T8.2: Orphan cleanup works
await createDocument();
await updateDocumentFile(docId, newFile); // Creates orphan
await time.advance("8 days");
const orphanCount = await runOrphanCleanup();
assert(orphanCount >= 1);

// T8.3: Key rotation
const doc = await createDocument();
await rotateKey(newMasterKey);
await runKeyRotationJob();
const file = await db.query(
  "SELECT master_key_version FROM document_files WHERE document_id = $1",
  [doc.id],
);
assert(file.master_key_version === 2); // Upgraded

// T8.4: Decryption still works after rotation
const decrypted = await getDocument(doc.id);
assert(decrypted.content.equals(originalContent));
```

### 8.5 Subtleties & Gotchas

> [!CAUTION]
> **Key rotation must be gradual**  
> Never delete the old key until ALL rows are migrated. Keep both keys active during transition.

> [!WARNING]
> **Job failures are silent**  
> Ensure proper error logging and alerting for background jobs.

> [!NOTE]
> **storage_cleanup_queue table**  
> You may need to create this table if not already defined in the architecture doc.

---

## Pre-Launch Checklist

### Security Review

- [ ] All PII encrypted at rest
- [ ] No raw filenames stored (hashed only)
- [ ] No raw IPs in logs (hashed only)
- [ ] RLS enabled on all tables
- [ ] Storage buckets are private
- [ ] Edge Functions use service_role for sensitive operations
- [ ] Master key stored in Vault, not in code
- [ ] OAuth tokens encrypted

### GDPR Compliance

- [ ] Data classification documented (Tier A/B/C)
- [ ] Soft delete implemented
- [ ] 7-day file deletion verified
- [ ] 30-day anonymization verified
- [ ] Data export function working
- [ ] Access logs preserved after deletion
- [ ] No PII in access logs

### Performance

- [ ] Indexes created and verified with EXPLAIN ANALYZE
- [ ] Queue processing uses SKIP LOCKED
- [ ] Deduplication prevents unnecessary processing
- [ ] Rate limiting prevents cloud API abuse

### Monitoring

- [ ] Error logging in place
- [ ] Key metrics tracked (queue depth, processing time)
- [ ] Alerts configured for critical failures
- [ ] Job success/failure logging

---

## Summary Statistics

| Metric              | Count |
| ------------------- | ----- |
| **Total Tasks**     | ~150  |
| **Tables**          | 5     |
| **Indexes**         | 10+   |
| **Edge Functions**  | 7     |
| **RPC Functions**   | 6+    |
| **Background Jobs** | 4+    |
| **Test Cases**      | 40+   |
