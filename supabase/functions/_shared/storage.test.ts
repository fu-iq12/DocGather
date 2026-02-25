/**
 * Unit tests for storage utilities.
 * Run with: deno test supabase/functions/_shared/storage.test.ts
 */

import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

import {
  buildDocumentPath,
  extractDocumentIdFromPath,
  extractOwnerIdFromPath,
  BUCKETS,
} from "./storage.ts";

// =============================================================================
// buildDocumentPath tests
// =============================================================================

Deno.test("buildDocumentPath - builds correct path for original file", () => {
  const path = buildDocumentPath("owner-123", "doc-456", "original", "pdf");
  assertEquals(path, "owner-123/doc-456/original.pdf");
});

Deno.test("buildDocumentPath - builds correct path for converted PDF", () => {
  const path = buildDocumentPath(
    "abc-def-ghi",
    "xyz-123",
    "converted_pdf",
    "pdf",
  );
  assertEquals(path, "abc-def-ghi/xyz-123/converted_pdf.pdf");
});

Deno.test("buildDocumentPath - throws on missing parameters", () => {
  assertThrows(
    () => buildDocumentPath("", "doc", "original", "pdf"),
    Error,
    "All parameters are required",
  );

  assertThrows(
    () => buildDocumentPath("owner", "", "original", "pdf"),
    Error,
    "All parameters are required",
  );
});

// =============================================================================
// Path extraction tests
// =============================================================================

Deno.test("extractDocumentIdFromPath - extracts document ID", () => {
  const docId = extractDocumentIdFromPath("owner-123/doc-456/original.pdf");
  assertEquals(docId, "doc-456");
});

Deno.test("extractDocumentIdFromPath - returns null for invalid path", () => {
  const docId = extractDocumentIdFromPath("just-one-segment");
  assertEquals(docId, null);
});

Deno.test("extractOwnerIdFromPath - extracts owner ID", () => {
  const ownerId = extractOwnerIdFromPath("owner-123/doc-456/original.pdf");
  assertEquals(ownerId, "owner-123");
});

Deno.test("extractOwnerIdFromPath - works with minimal path", () => {
  const ownerId = extractOwnerIdFromPath("owner-only");
  assertEquals(ownerId, "owner-only");
});

// =============================================================================
// Constants tests
// =============================================================================

Deno.test("BUCKETS - has correct bucket names", () => {
  assertEquals(BUCKETS.DOCUMENTS, "documents");
});
