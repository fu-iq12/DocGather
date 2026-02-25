/**
 * Tests for validation utilities.
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { isValidFileSize, MAX_FILE_SIZE } from "./validation.ts";

Deno.test("isValidFileSize - accepts valid sizes", () => {
  assertEquals(isValidFileSize(1), true); // 1 byte
  assertEquals(isValidFileSize(1024), true); // 1 KB
  assertEquals(isValidFileSize(1024 * 1024), true); // 1 MB
  assertEquals(isValidFileSize(MAX_FILE_SIZE), true); // Exactly max
});

Deno.test("isValidFileSize - rejects zero size", () => {
  assertEquals(isValidFileSize(0), false);
});

Deno.test("isValidFileSize - rejects negative size", () => {
  assertEquals(isValidFileSize(-1), false);
});

Deno.test("isValidFileSize - rejects too large", () => {
  assertEquals(isValidFileSize(MAX_FILE_SIZE + 1), false);
});

Deno.test("isValidFileSize - custom max size", () => {
  assertEquals(isValidFileSize(100, 50), false); // 100 bytes with 50 max
  assertEquals(isValidFileSize(50, 100), true); // 50 bytes with 100 max
});

Deno.test("MAX_FILE_SIZE - is 50 MiB", () => {
  assertEquals(MAX_FILE_SIZE, 50 * 1024 * 1024);
});
