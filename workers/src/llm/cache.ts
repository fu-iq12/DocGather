/**
 * Local filesystem cache for LLM request/response pairs.
 * Used primarily during development to avoid redundant API calls and costs
 * for identically processed documents or images.
 * Cache key: <model id>/<prompt hash>/<content hash>.json
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
 * Generates a SHA-256 hash truncated to 16 characters for cache key derivation.
 */
function hash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/**
 * Derives a unique deterministic cache key from the model identifier, system prompt, and user content (text or image).
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
 * Manages the persistence and retrieval of LLM responses on the local filesystem.
 */
export class LLMCache {
  constructor(private cacheDir: string) {}

  /**
   * Constructs the physical path for a cache file.
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
   * Retrieves a cached LLM response if it exists and matches the deterministic request parameters.
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
   * Serializes and writes an LLM response to the disk cache.
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
   * Removes a specific cached request/response pair from the disk.
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
   * Verifies the cache directory exists and can be written to.
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
