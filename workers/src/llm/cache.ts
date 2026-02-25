/**
 * LLM Response Cache
 *
 * Caches LLM responses to disk for faster development iteration.
 * Cache key: <file hash>/<request hash>/<model id>.json
 */

import { createHash } from "crypto";
import { mkdir, readFile, writeFile, access, unlink } from "fs/promises";
import { join, dirname } from "path";
import type { ChatResponse } from "./types.js";

type CacheRequest =
  | {
      systemPrompt: string;
      userPrompt: string;
    }
  | {
      systemPrompt: string;
      imageBuffer: ArrayBuffer;
    };

/**
 * Generate a hash for cache key
 */
function hash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/**
 * Generate cache key from messages and model
 */
function getCacheKey(
  request: CacheRequest,
  model: string,
): { modelId: string; promptHash: string; contentHash: string } {
  let promptHash = hash(request.systemPrompt);
  let contentHash: string;

  if ("imageBuffer" in request) {
    contentHash = hash(Buffer.from(request.imageBuffer).toString("base64"));
  } else {
    contentHash = hash(request.userPrompt);
  }

  // Sanitize model name for filesystem
  const modelId = model.replace(/[^a-zA-Z0-9.-]/g, "_");

  return { modelId, promptHash, contentHash };
}

/**
 * LLM Response Cache
 */
export class LLMCache {
  constructor(private cacheDir: string) {}

  /**
   * Get cache file path
   */
  private getCachePath(
    prefix: string,
    modelId: string,
    promptHash: string,
    contentHash: string,
  ): string {
    const parts = [
      this.cacheDir,
      prefix,
      modelId,
      promptHash,
      `${contentHash}.json`,
    ];
    return join(...parts.filter((path) => path));
  }

  /**
   * Try to get cached response
   */
  async get(
    request: CacheRequest,
    model: string,
    prefix: string = "default",
  ): Promise<ChatResponse | null> {
    const { modelId, promptHash, contentHash } = getCacheKey(request, model);
    const cachePath = this.getCachePath(
      prefix,
      modelId,
      promptHash,
      contentHash,
    );

    try {
      await access(cachePath);
      const data = await readFile(cachePath, "utf-8");
      const cached = JSON.parse(data) as ChatResponse;
      return { ...cached, cached: true };
    } catch {
      return null;
    }
  }

  /**
   * Store response in cache
   */
  async set(
    request: CacheRequest,
    model: string,
    response: ChatResponse,
    prefix: string = "default",
  ): Promise<void> {
    const { modelId, promptHash, contentHash } = getCacheKey(request, model);
    const cachePath = this.getCachePath(
      prefix,
      modelId,
      promptHash,
      contentHash,
    );

    // Create directory structure
    await mkdir(dirname(cachePath), { recursive: true });

    // Write response
    await writeFile(cachePath, JSON.stringify(response, null, 2), "utf-8");

    console.log(`[LLMCache] Cached response to ${cachePath}`);
  }

  /**
   * Delete a cached response
   */
  async delete(
    request: CacheRequest,
    model: string,
    prefix: string = "default",
  ): Promise<boolean> {
    const { modelId, promptHash, contentHash } = getCacheKey(request, model);
    const cachePath = this.getCachePath(
      prefix,
      modelId,
      promptHash,
      contentHash,
    );

    try {
      await unlink(cachePath);
      console.log(`[LLMCache] Deleted cached response at ${cachePath}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if cache is enabled and accessible
   */
  async isEnabled(): Promise<boolean> {
    try {
      await mkdir(this.cacheDir, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }
}

export { getCacheKey, hash };
