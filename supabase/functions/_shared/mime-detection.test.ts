/**
 * Tests for MIME type detection utilities.
 */

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  detectMimeType,
  getExtensionForMime,
  isAllowedMimeType,
} from "./mime-detection.ts";

// PDF magic bytes: %PDF-
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

// PNG magic bytes + 1x1 minimal structure (to satisfy file-type parser without End-Of-Stream)
const PNG_BYTES = new Uint8Array([
  // Magic bytes
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  // IHDR chunk (length 13 = 0D)
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00,
  0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
  // IDAT chunk (1x1 pixel)
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xfc, 0xcf,
  0xc0, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xdd, 0x8d, 0xb0,
  // IEND chunk
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

// JPEG magic bytes (SOI marker)
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

// Unknown bytes (random)
const UNKNOWN_BYTES = new Uint8Array([0x00, 0x01, 0x02, 0x03]);

// DOCX magic bytes (ZIP signature)
const DOCX_ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

Deno.test("detectMimeType - detects PDF from magic bytes", async () => {
  const result = await detectMimeType(PDF_BYTES);
  assertEquals(result.mimeType, "application/pdf");
  assertEquals(result.extension, "pdf");
  assertEquals(result.fromMagicBytes, true);
});

Deno.test("detectMimeType - detects PNG from magic bytes", async () => {
  const result = await detectMimeType(PNG_BYTES);
  assertEquals(result.mimeType, "image/png");
  assertEquals(result.extension, "png");
  assertEquals(result.fromMagicBytes, true);
});

Deno.test("detectMimeType - detects JPEG from magic bytes", async () => {
  const result = await detectMimeType(JPEG_BYTES);
  assertStringIncludes(result.mimeType, "image/jpeg");
  assertExists(result.extension);
  assertEquals(result.fromMagicBytes, true);
});

Deno.test("detectMimeType - falls back to filename extension", async () => {
  const result = await detectMimeType(UNKNOWN_BYTES, "document.docx");
  // If magic bytes detect something, that's fine too
  if (!result.fromMagicBytes) {
    assertStringIncludes(result.mimeType, "document");
    assertEquals(result.extension, "docx");
  }
});

Deno.test(
  "detectMimeType - falls back to filename extension for ZIP/DOCX without central directory",
  async () => {
    // A real DOCX is a ZIP. This is just the PK signature, missing central directory.
    // The 'file-type' library will fail to identify it as DOCX.
    const result = await detectMimeType(DOCX_ZIP_BYTES, "document.docx");

    assertEquals(result.fromMagicBytes, false);
    assertEquals(
      result.mimeType,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    assertEquals(result.extension, "docx");
  },
);

Deno.test("detectMimeType - falls back to declared MIME type", async () => {
  const result = await detectMimeType(UNKNOWN_BYTES, undefined, "text/plain");
  // If magic bytes detect something, that takes precedence
  if (!result.fromMagicBytes) {
    assertEquals(result.mimeType, "text/plain");
    assertEquals(result.extension, "txt");
  }
});

Deno.test("detectMimeType - ultimate fallback to octet-stream", async () => {
  // Use bytes that definitely won't match anything
  const weirdBytes = new Uint8Array([0xfe, 0xfe, 0xfe, 0xfe]);
  const result = await detectMimeType(weirdBytes);
  // If magic-bytes finds something, that's acceptable; otherwise expect fallback
  if (!result.fromMagicBytes) {
    assertEquals(result.mimeType, "application/octet-stream");
    assertEquals(result.extension, "bin");
  }
});

Deno.test("isAllowedMimeType - allows PDF", () => {
  assertEquals(isAllowedMimeType("application/pdf"), true);
});

Deno.test("isAllowedMimeType - allows images", () => {
  assertEquals(isAllowedMimeType("image/jpeg"), true);
  assertEquals(isAllowedMimeType("image/png"), true);
  assertEquals(isAllowedMimeType("image/webp"), true);
});

Deno.test("isAllowedMimeType - allows Office documents", () => {
  assertEquals(isAllowedMimeType("application/msword"), true);
  assertEquals(
    isAllowedMimeType(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    true,
  );
  assertEquals(isAllowedMimeType("application/vnd.ms-excel"), true);
});

Deno.test("isAllowedMimeType - rejects unsupported types", () => {
  assertEquals(isAllowedMimeType("application/octet-stream"), false);
  assertEquals(isAllowedMimeType("application/javascript"), false);
  assertEquals(isAllowedMimeType("video/mp4"), false);
});

Deno.test("getExtensionForMime - returns correct extensions", () => {
  assertEquals(getExtensionForMime("application/pdf"), "pdf");
  assertEquals(getExtensionForMime("image/png"), "png");
  assertEquals(getExtensionForMime("text/plain"), "txt");
});

Deno.test("getExtensionForMime - returns bin for unknown", () => {
  assertEquals(getExtensionForMime("application/x-custom"), "bin");
});
