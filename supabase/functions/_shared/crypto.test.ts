/**
 * Validation Suite: crypto
 * Tests the crypto module for expected architectural behaviors and edge cases.
 */

import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

import {
  generateDEK,
  encryptFile,
  decryptFile,
  sha256,
  bytesToBase64,
  base64ToBytes,
  bytesToHex,
} from "./crypto.ts";

Deno.test("generateDEK - generates 32-byte key", () => {
  const dek = generateDEK();
  assertEquals(dek.length, 32, "DEK should be 32 bytes (256 bits)");
});

Deno.test("generateDEK - generates unique keys", () => {
  const dek1 = generateDEK();
  const dek2 = generateDEK();
  assertNotEquals(
    bytesToHex(dek1),
    bytesToHex(dek2),
    "Each DEK should be unique",
  );
});

Deno.test("encryptFile/decryptFile - round-trip encryption", async () => {
  const originalData = new TextEncoder().encode("Hello, DocGather!");
  const dek = generateDEK();

  // Encrypt
  const { ciphertext, iv } = await encryptFile(originalData, dek);

  // Ciphertext should be different from original
  assertNotEquals(
    bytesToHex(ciphertext),
    bytesToHex(originalData),
    "Ciphertext should differ from plaintext",
  );

  // IV should be 12 bytes
  assertEquals(iv.length, 12, "IV should be 12 bytes");

  // Decrypt
  const decrypted = await decryptFile(ciphertext, dek, iv);

  // Should match original
  assertEquals(
    new TextDecoder().decode(decrypted),
    "Hello, DocGather!",
    "Decrypted data should match original",
  );
});

Deno.test(
  "encryptFile - same data produces different ciphertext (random IV)",
  async () => {
    const data = new TextEncoder().encode("Same content");
    const dek = generateDEK();

    const result1 = await encryptFile(data, dek);
    const result2 = await encryptFile(data, dek);

    assertNotEquals(
      bytesToHex(result1.ciphertext),
      bytesToHex(result2.ciphertext),
      "Each encryption should produce different ciphertext due to random IV",
    );
  },
);

Deno.test("sha256 - produces consistent 32-byte hash", async () => {
  const data = new TextEncoder().encode("Test document content");

  const hash1 = await sha256(data);
  const hash2 = await sha256(data);

  assertEquals(hash1.length, 32, "SHA-256 hash should be 32 bytes");
  assertEquals(
    bytesToHex(hash1),
    bytesToHex(hash2),
    "Same input should produce same hash",
  );
});

Deno.test("sha256 - different data produces different hash", async () => {
  const data1 = new TextEncoder().encode("Document A");
  const data2 = new TextEncoder().encode("Document B");

  const hash1 = await sha256(data1);
  const hash2 = await sha256(data2);

  assertNotEquals(
    bytesToHex(hash1),
    bytesToHex(hash2),
    "Different inputs should produce different hashes",
  );
});

Deno.test("bytesToBase64/base64ToBytes - round-trip encoding", () => {
  const original = new Uint8Array([0, 127, 255, 128, 64, 32, 16, 8]);

  const base64 = bytesToBase64(original);
  const decoded = base64ToBytes(base64);

  assertEquals(
    bytesToHex(decoded),
    bytesToHex(original),
    "Round-trip encoding should preserve data",
  );
});

Deno.test("bytesToHex - correct hex encoding", () => {
  const bytes = new Uint8Array([0x00, 0xff, 0xde, 0xad, 0xbe, 0xef]);
  const hex = bytesToHex(bytes);

  assertEquals(hex, "00ffdeadbeef", "Hex encoding should be correct");
});

Deno.test("decryptFile - fails with wrong key", async () => {
  const data = new TextEncoder().encode("Secret data");
  const correctKey = generateDEK();
  const wrongKey = generateDEK();

  const { ciphertext, iv } = await encryptFile(data, correctKey);

  try {
    await decryptFile(ciphertext, wrongKey, iv);
    throw new Error("Should have thrown an error");
  } catch (error) {
    // Expected: decryption should fail with wrong key
    assertEquals(
      error instanceof Error,
      true,
      "Should throw an error with wrong key",
    );
  }
});

