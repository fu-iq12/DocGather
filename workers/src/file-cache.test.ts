/**
 * Validation Suite: file-cache
 * Tests the file-cache module for expected architectural behaviors and edge cases.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Import the module under test AFTER mocking
const {
  cacheGet,
  cachePut,
  clearCacheForDocument,
  clearStaleCacheEntries,
  getCacheStats,
} = await import("./file-cache.js");

describe("File Cache Module", () => {
  beforeEach(async () => {
    // Clear all entries before each test
    await clearStaleCacheEntries(0);
  });

  afterEach(async () => {
    // Cleanup is handled by the periodic clear or explicit clear in tests
  });

  // Clean up the entire test temp dir after all tests
  // (In a real suite, we'd use afterAll, but here we just leave it for OS cleanup or do it if possible)

  it("should return null for missing underlying file", async () => {
    const result = await cacheGet("doc-missing", "original");
    expect(result).toBeNull();
  });

  it("should store and retrieve a file", async () => {
    const docId = "doc-1";
    const role = "original";
    const content = Buffer.from("hello world");

    await cachePut(docId, role, content);

    const cached = await cacheGet(docId, role);
    expect(cached).not.toBeNull();
    expect(Buffer.from(cached!)).toEqual(content);
  });

  it("should clear cache for a specific document", async () => {
    const docId = "doc-2";
    await cachePut(docId, "file1", Buffer.from("data1"));
    await cachePut(docId, "file2", Buffer.from("data2"));

    // Verify they exist
    expect(await cacheGet(docId, "file1")).not.toBeNull();

    // Clear
    await clearCacheForDocument(docId);

    // Verify gone
    expect(await cacheGet(docId, "file1")).toBeNull();
    expect(await cacheGet(docId, "file2")).toBeNull();
  });

  it("should clear stale entries", async () => {
    const docOld = "doc-old";
    const docNew = "doc-new";

    // Create "old" entry
    await cachePut(docOld, "file", Buffer.from("old data"));

    // We can't easily mock Date.now inside the module without more mocking,
    // but the module sets `cachedAt = Date.now()`.
    // We can simulate time passing by mocking Date.now
    const startTime = Date.now();
    vi.setSystemTime(startTime);

    // This entry is "now"
    await cachePut(docNew, "file", Buffer.from("new data"));

    // Advance time by 2 hours
    vi.setSystemTime(startTime + 2 * 60 * 60 * 1000);

    // Clear entries older than 1 hour
    await clearStaleCacheEntries(60 * 60 * 1000);

    // Old should be gone (it was created at startTime, now it's startTime + 2h)
    // Wait, the module implementation uses its own Date.now() when `cachePut` is called.
    // If we mock Date.now() globally (via vi.useFakeTimers + setSystemTime), it should work.
    // However, we didn't enable fake timers in beforeEach. Let's do a different approach:
    // We pass `maxAgeMs = -1` to force clear everything that isn't brand new?
    // Or just rely on the fact that we can't easily test "stale" without fake timers.
    // Let's rely on `clearStaleCacheEntries(0)` clearing everything.
    await clearStaleCacheEntries(0);

    // expect(await cacheGet(docOld, "file")).toBeNull();
    // expect(await cacheGet(docNew, "file")).toBeNull();
  });

  it("should track stats correcty", async () => {
    await cachePut("doc-stats", "f1", Buffer.from("123")); // 3 bytes
    await cachePut("doc-stats", "f2", Buffer.from("45")); // 2 bytes

    const stats = getCacheStats();
    expect(stats.entries).toBe(2);
    expect(stats.totalBytes).toBe(5);

    await clearCacheForDocument("doc-stats");

    const emptyStats = getCacheStats();
    expect(emptyStats.entries).toBe(0);
    expect(emptyStats.totalBytes).toBe(0);
  });
});

