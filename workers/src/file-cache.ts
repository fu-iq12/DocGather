/**
 * File Cache Module
 *
 * Provides a temporary, local filesystem cache for downloaded files to avoid
 * redundant network requests and decryption overhead during document processing.
 *
 * Cache strategy:
 * - Files are stored in the OS temp directory under a `docgather-cache` subdirectory.
 * - An in-memory Map tracks valid cache entries.
 * - Cache is ephemeral (cleared on restart) and local to the worker instance.
 * - Explicit cleanup is provided via `clearCacheForDocument` (called by orchestrator).
 * - Periodic cleanup is provided via `clearStaleCacheEntries` (called by main loop).
 */

import { mkdir, readFile, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// Verify we can use path.join safely
const CACHE_ROOT = join(tmpdir(), "docgather-cache");
const FILE_CACHE_KEEP_ON_DISK = process.env.FILE_CACHE_KEEP_ON_DISK !== "false";

interface CacheEntry {
  /** Absolute path to the cached (unencrypted) file on disk */
  filePath: string;
  /** documentId that owns this entry */
  documentId: string;
  /** File role (original, llm_optimized, etc.) */
  fileRole: string;
  /** Timestamp when entry was last written/accessed (ms since epoch) */
  cachedAt: number;
  /** Size of the cached file in bytes */
  sizeBytes: number;
}

// In-memory registry of valid cache entries
// Key: `${documentId}/${fileRole}`
const cache = new Map<string, CacheEntry>();

/**
 * Generate a consistent cache key
 */
function getCacheKey(documentId: string, fileRole: string): string {
  return `${documentId}/${fileRole}`;
}

/**
 * Ensure the cache directory exists for a specific document
 */
async function ensureDocumentDir(documentId: string): Promise<string> {
  const docDir = join(CACHE_ROOT, documentId);
  await mkdir(docDir, { recursive: true });
  return docDir;
}

/**
 * Retrieve a file from the cache
 *
 * @returns The file content as ArrayBuffer, or null if not found/expired
 */
export async function cacheGet(
  documentId: string,
  fileRole: string,
): Promise<ArrayBuffer | null> {
  const key = getCacheKey(documentId, fileRole);
  const entry = cache.get(key);

  if (!entry) {
    return null;
  }

  try {
    // verify file exists
    await stat(entry.filePath);

    // update access time in memory (optional, for LRU if we implemented it)
    entry.cachedAt = Date.now();

    // read file
    const buffer = await readFile(entry.filePath);
    return new Uint8Array(buffer).buffer as ArrayBuffer;
  } catch (error) {
    // If file is missing on disk but in map, remove from map
    console.warn(
      `[FileCache] Entry exists but file missing for ${key}: ${error}`,
    );
    cache.delete(key);
    return null;
  }
}

/**
 * Store a file in the cache
 */
export async function cachePut(
  documentId: string,
  fileRole: string,
  data: ArrayBufferLike | Buffer,
): Promise<void> {
  const key = getCacheKey(documentId, fileRole);
  const docDir = await ensureDocumentDir(documentId);
  const filename = `${fileRole}.bin`;
  const filePath = join(docDir, filename);

  try {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    await writeFile(filePath, buffer);

    cache.set(key, {
      filePath,
      documentId,
      fileRole,
      cachedAt: Date.now(),
      sizeBytes: buffer.length,
    });
  } catch (error) {
    console.error(`[FileCache] Failed to write cache for ${key}: ${error}`);
    // Do not throw; caching is an optimization, not a hard requirement.
    // Downstream will continue with non-cached flow if this fails (though caller usually awaits this).
  }
}

/**
 * Clear all cache entries and files for a specific document
 *
 * Should be called when processing for a document is complete or fails.
 */
export async function clearCacheForDocument(documentId: string): Promise<void> {
  // 1. Remove from map
  for (const [key, entry] of cache.entries()) {
    if (entry.documentId === documentId) {
      cache.delete(key);
    }
  }

  // 2. Remove directory from disk
  const docDir = join(CACHE_ROOT, documentId);
  try {
    if (!FILE_CACHE_KEEP_ON_DISK) {
      await rm(docDir, { recursive: true, force: true });
    }
  } catch (error) {
    console.error(
      `[FileCache] Failed to remove doc dir ${documentId}: ${error}`,
    );
  }
}

/**
 * Clear cache entries that haven't been accessed/written in `maxAgeMs`.
 *
 * Should be called periodically to clean up orphaned files.
 */
export async function clearStaleCacheEntries(
  maxAgeMs: number = 60 * 60 * 1000,
): Promise<number> {
  const now = Date.now();
  let clearedCount = 0;
  const docsToClear = new Set<string>();

  // Identify stale entries
  for (const [key, entry] of cache.entries()) {
    if (now - entry.cachedAt > maxAgeMs) {
      docsToClear.add(entry.documentId);
    }
  }

  // We clear by document ID to keep things simple (all or nothing per doc)
  // This assumes that if one file in a doc is stale, the whole doc processing is likely done/stale.
  for (const documentId of docsToClear) {
    await clearCacheForDocument(documentId);
    clearedCount++;
  }

  if (clearedCount > 0) {
    console.log(`[FileCache] Cleared ${clearedCount} stale document contexts`);
  }

  return clearedCount;
}

/**
 * Get cache statistics for observability
 */
export function getCacheStats(): { entries: number; totalBytes: number } {
  let totalBytes = 0;
  for (const entry of cache.values()) {
    totalBytes += entry.sizeBytes;
  }
  return {
    entries: cache.size,
    totalBytes,
  };
}
