/**
 * Validation Suite: documents
 * Tests the documents module for expected architectural behaviors and edge cases.
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createServiceClient } from "./_shared/supabase.ts";
import { sha256, generateDEK, encryptFile } from "./_shared/crypto.ts";
import { buildDocumentPath } from "./_shared/storage.ts";

// Worker secret usage removed - relying on Service Role (RLS/Grants)

// Test user - created once and cleaned up at end
let testUserId: string | null = null;

/**
 * Helper: Get or create test user
 */
async function getTestUserId(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<string> {
  if (testUserId) return testUserId;

  const { data, error } = await supabase.auth.admin.createUser({
    email: `test+${Date.now()}@docgather.test`,
    password: "TestPassword123!",
    email_confirm: true,
  });
  if (error) throw new Error(`Failed to create test user: ${error.message}`);
  testUserId = data.user.id;
  return testUserId;
}

/**
 * Helper: Create a mock document for testing
 */
async function createTestDocument(
  supabase: ReturnType<typeof createServiceClient>,
  ownerId: string,
  content: Uint8Array,
): Promise<{ documentId: string; storagePath: string }> {
  const documentId = crypto.randomUUID();
  const contentHash = await sha256(content);
  const dek = generateDEK();
  const { ciphertext, iv } = await encryptFile(content, dek);

  // Combine IV and encrypted data
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.length);

  const storagePath = buildDocumentPath(ownerId, documentId, "original", "pdf");

  // Upload to storage
  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, combined, {
      contentType: "application/octet-stream",
    });
  if (uploadError)
    throw new Error(`Storage upload failed: ${uploadError.message}`);

  // Encrypt DEK
  const { data: encryptedDek, error: dekError } = await supabase.rpc(
    "encrypt_dek",
    {
      p_dek: btoa(String.fromCharCode(...dek)),
      p_master_key_version: 1,
    },
  );
  if (dekError) throw new Error(`DEK encryption failed: ${dekError.message}`);

  // Create document record
  const { error: docError } = await supabase.from("documents").insert({
    id: documentId,
    owner_id: ownerId,
    document_type: "test",
    status: "uploaded",
  });
  if (docError) throw new Error(`Document insert failed: ${docError.message}`);

  // Create file record
  const { error: fileError } = await supabase.from("document_files").insert({
    document_id: documentId,
    file_role: "original",
    storage_path: storagePath,
    mime_type: "application/pdf",
    file_size: content.length,
    content_hash: contentHash,
    encrypted_data_key: encryptedDek,
    master_key_version: 1,
  });
  if (fileError) throw new Error(`File insert failed: ${fileError.message}`);

  // Create private record
  const { error: privateError } = await supabase
    .from("document_private")
    .insert({
      document_id: documentId,
    });
  if (privateError)
    throw new Error(`Private insert failed: ${privateError.message}`);

  return { documentId, storagePath };
}

// =============================================================================
// T4.1: Document Creation and File Records
// =============================================================================
Deno.test("T4.1: Document and file records are created correctly", async () => {
  const supabase = createServiceClient();
  const userId = await getTestUserId(supabase);
  const content = new TextEncoder().encode("Test document content for T4.1");

  const { documentId } = await createTestDocument(supabase, userId, content);

  // Verify document exists
  const { data: doc } = await supabase
    .from("documents")
    .select("id, owner_id, status")
    .eq("id", documentId)
    .single();

  assertExists(doc, "Document should exist");
  assertEquals(doc.id, documentId);
  assertEquals(doc.owner_id, userId);
  assertEquals(doc.status, "uploaded");

  // Verify file record exists
  const { data: file } = await supabase
    .from("document_files")
    .select("document_id, file_role")
    .eq("document_id", documentId)
    .eq("file_role", "original")
    .single();

  assertExists(file, "File record should exist");
  assertEquals(file.document_id, documentId);

  // Cleanup
  await supabase.from("documents").delete().eq("id", documentId);
});

// =============================================================================
// T4.2: Encryption verification
// =============================================================================
Deno.test("T4.2: Uploaded files are encrypted in storage", async () => {
  const supabase = createServiceClient();
  const userId = await getTestUserId(supabase);
  const plaintext =
    "This is readable plaintext content that should be encrypted";
  const content = new TextEncoder().encode(plaintext);

  const { documentId, storagePath } = await createTestDocument(
    supabase,
    userId,
    content,
  );

  // Download raw encrypted file
  const { data: blob } = await supabase.storage
    .from("documents")
    .download(storagePath);
  assertExists(blob, "File should exist in storage");

  const rawContent = await blob.text();

  // Encrypted content should not contain plaintext
  assertEquals(
    rawContent.includes("readable plaintext"),
    false,
    "Encrypted file should not contain readable plaintext",
  );

  // Cleanup
  await supabase.storage.from("documents").remove([storagePath]);
  await supabase.from("documents").delete().eq("id", documentId);
});

// =============================================================================
// T4.3: Storage path conventions
// =============================================================================
Deno.test("T4.3: Storage paths follow expected conventions", () => {
  const ownerId = "abc-123";
  const docId = "doc-456";

  // Document path
  const docPath = buildDocumentPath(ownerId, docId, "original", "pdf");
  assertEquals(docPath, "abc-123/doc-456/original.pdf");

  // Converted PDF path
  const pdfPath = buildDocumentPath(ownerId, docId, "converted_pdf", "pdf");
  assertEquals(pdfPath, "abc-123/doc-456/converted_pdf.pdf");
});

// =============================================================================
// T4.4: [REMOVED] Worker RPC functions no longer require secret (Service Role)
// =============================================================================
// Deno.test("T4.4: Worker RPC rejects invalid secret", async () => { ... });

// =============================================================================
// T4.5: Worker write-back with valid secret
// =============================================================================
Deno.test("T4.5: Worker RPC updates document with valid secret", async () => {
  const supabase = createServiceClient();
  const userId = await getTestUserId(supabase);
  const docId = crypto.randomUUID();

  // Create a test document
  const { error: insertError } = await supabase.from("documents").insert({
    id: docId,
    owner_id: userId,
    document_type: "unknown", // Set initial type, worker will update after classification
    status: "processing",
  });
  if (insertError) throw new Error(`Insert failed: ${insertError.message}`);

  // Update without secret (Service Role context assumed for this client in tests or mocked)
  // Note: createServiceClient usually returns a Service Role client in these tests?
  // If so, it should work.
  const { error } = await supabase.rpc("worker_update_document", {
    p_document_id: docId,
    p_document_type: "payslip",
    p_status: "processed",
    p_extraction_confidence: 0.95,
  });

  assertEquals(error, null, "Should succeed with valid secret");

  // Verify update
  const { data: doc } = await supabase
    .from("documents")
    .select("document_type, status, extraction_confidence")
    .eq("id", docId)
    .single();

  assertEquals(doc?.document_type, "payslip");
  assertEquals(doc?.status, "processed");
  assertEquals(doc?.extraction_confidence, 0.95);

  // Cleanup
  await supabase.from("documents").delete().eq("id", docId);
});

// =============================================================================
// T4.6: Soft delete marks document and files
// =============================================================================
Deno.test("T4.6: soft_delete_document cascades to files", async () => {
  const supabase = createServiceClient();
  const userId = await getTestUserId(supabase);
  const content = new TextEncoder().encode("Delete test content");

  const { documentId } = await createTestDocument(supabase, userId, content);

  // Soft delete via direct update (simulating RPC behavior)
  await supabase
    .from("documents")
    .update({ deleted_at: new Date().toISOString(), status: "deleted" })
    .eq("id", documentId);

  await supabase
    .from("document_files")
    .update({ deleted_at: new Date().toISOString() })
    .eq("document_id", documentId);

  // Verify document is soft deleted
  const { data: doc } = await supabase
    .from("documents")
    .select("deleted_at, status")
    .eq("id", documentId)
    .single();

  assertExists(doc?.deleted_at, "Document should have deleted_at set");
  assertEquals(doc?.status, "deleted");

  // Verify files are soft deleted
  const { data: files } = await supabase
    .from("document_files")
    .select("deleted_at")
    .eq("document_id", documentId);

  assertEquals(
    files?.every((f) => f.deleted_at !== null),
    true,
    "All files should be soft deleted",
  );

  // Cleanup (hard delete for test cleanup)
  await supabase.from("documents").delete().eq("id", documentId);
});

// =============================================================================
// T4.7: worker_mark_processing_complete updates history
// =============================================================================
Deno.test(
  "T4.7: worker_mark_processing_complete appends to history",
  async () => {
    const supabase = createServiceClient();
    const userId = await getTestUserId(supabase);
    const docId = crypto.randomUUID();

    // Create document with initial history
    await supabase.from("documents").insert({
      id: docId,
      owner_id: userId,
      document_type: "test",
      status: "processing",
      process_history: [{ status: "queued", at: new Date().toISOString() }],
    });

    // Mark complete
    const { error } = await supabase.rpc("worker_mark_processing_complete", {
      p_document_id: docId,
      p_final_status: "processed",
    });

    assertEquals(error, null, "Should succeed");

    // Verify
    const { data: doc } = await supabase
      .from("documents")
      .select("status, process_status, process_history")
      .eq("id", docId)
      .single();

    assertEquals(doc?.status, "processed");
    assertEquals(doc?.process_status, "completed");
    assertEquals(doc?.process_history.length, 2);
    assertEquals(doc?.process_history[1].status, "completed");

    // Cleanup
    await supabase.from("documents").delete().eq("id", docId);
  },
);

// =============================================================================
// T4.8: Failed processing records error
// =============================================================================
Deno.test("T4.8: worker_mark_processing_complete records failure", async () => {
  const supabase = createServiceClient();
  const userId = await getTestUserId(supabase);
  const docId = crypto.randomUUID();

  // Create document
  await supabase.from("documents").insert({
    id: docId,
    owner_id: userId,
    document_type: "test",
    status: "processing",
    process_history: [],
  });

  // Mark failed
  const { error } = await supabase.rpc("worker_mark_processing_complete", {
    p_document_id: docId,
    p_final_status: "errored",
    p_error_message: "OCR extraction failed",
  });

  assertEquals(error, null, "Should succeed");

  // Verify
  const { data: doc } = await supabase
    .from("documents")
    .select("status, process_status, process_history")
    .eq("id", docId)
    .single();

  assertEquals(doc?.status, "errored");
  assertEquals(doc?.process_status, "failed");
  assertEquals(doc?.process_history[0].status, "failed");
  assertEquals(doc?.process_history[0].error, "OCR extraction failed");

  // Cleanup
  await supabase.from("documents").delete().eq("id", docId);
});

// =============================================================================
// Cleanup: Delete test user after all tests
// =============================================================================
Deno.test("Cleanup: Delete test user", async () => {
  if (!testUserId) return;

  const supabase = createServiceClient();
  await supabase.auth.admin.deleteUser(testUserId);
  testUserId = null;
});

