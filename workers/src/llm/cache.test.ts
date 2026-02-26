/**
 * Validation Suite: cache
 * Tests the cache module for expected architectural behaviors and edge cases.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs/promises
const mockMkdir = vi.fn();
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockAccess = vi.fn();
const mockUnlink = vi.fn();

vi.mock("fs/promises", () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  access: (...args: unknown[]) => mockAccess(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
}));

// Import after mocking
const { LLMCache, getCacheKey, hash } = await import("./cache.js");

describe("LLM cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("hash", () => {
    it("should generate consistent hashes", () => {
      const h1 = hash("test input");
      const h2 = hash("test input");
      expect(h1).toBe(h2);
    });

    it("should generate different hashes for different input", () => {
      const h1 = hash("input1");
      const h2 = hash("input2");
      expect(h1).not.toBe(h2);
    });

    it("should return 16 character hex string", () => {
      const h = hash("test");
      expect(h).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  describe("getCacheKey", () => {
    it("should generate correct prompt and content hashes for text requests", () => {
      const request = {
        systemPrompt: "system prompt",
        userPrompt: "user prompt",
      };

      const key = getCacheKey(request, "test-model");

      expect(key.modelId).toBe("test-model");
      expect(key.promptHash).toBe(hash("system prompt"));
      expect(key.contentHash).toBe(hash("user prompt"));
    });

    it("should generate correct prompt and content hashes for image requests", () => {
      const imageBuffer = Buffer.from("fake image data");
      const request = {
        systemPrompt: "system prompt",
        imageBuffer: new Uint8Array(imageBuffer).buffer,
      };

      const key = getCacheKey(request, "test-model");

      expect(key.modelId).toBe("test-model");
      expect(key.promptHash).toBe(hash("system prompt"));
      // Implementation uses base64 string of buffer for hash
      expect(key.contentHash).toBe(hash(imageBuffer.toString("base64")));
    });

    it("should sanitize model names for filesystem", () => {
      const request = {
        systemPrompt: "test",
        userPrompt: "test",
      };

      const key = getCacheKey(request, "org/model:v1");

      expect(key.modelId).toBe("org_model_v1");
      expect(key.modelId).not.toContain("/");
      expect(key.modelId).not.toContain(":");
    });
  });

  describe("LLMCache", () => {
    const cacheDir = "/tmp/cache";
    const simpleRequest = {
      systemPrompt: "system",
      userPrompt: "user",
    };

    it("should return null on cache miss", async () => {
      mockAccess.mockRejectedValue(new Error("ENOENT"));

      const cache = new LLMCache(cacheDir);
      const result = await cache.get(simpleRequest, "model");

      expect(result).toBeNull();
    });

    it("should return cached response on hit", async () => {
      mockAccess.mockResolvedValue(undefined);
      mockReadFile.mockResolvedValue(
        JSON.stringify({
          content: "Cached content",
          model: "test-model",
        }),
      );

      const cache = new LLMCache(cacheDir);
      const result = await cache.get(simpleRequest, "model");

      expect(result).not.toBeNull();
      expect(result?.content).toBe("Cached content");
      expect(result?.cached).toBe(true);
    });

    it("should write to cache on set", async () => {
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      const cache = new LLMCache(cacheDir);
      const response = {
        content: "Response",
        model: "model",
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      };

      // @ts-ignore
      await cache.set(simpleRequest, "model", response);

      expect(mockMkdir).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it("should delete cached items", async () => {
      mockUnlink.mockResolvedValue(undefined);

      const cache = new LLMCache(cacheDir);
      const result = await cache.delete(simpleRequest, "model");

      expect(result).toBe(true);
      expect(mockUnlink).toHaveBeenCalled();
    });

    it("should handle delete when file missing", async () => {
      mockUnlink.mockRejectedValue(new Error("ENOENT"));

      const cache = new LLMCache(cacheDir);
      const result = await cache.delete(simpleRequest, "model");

      expect(result).toBe(false);
    });

    it("should check if enabled", async () => {
      mockMkdir.mockResolvedValue(undefined);
      const cache = new LLMCache(cacheDir);
      const enabled = await cache.isEnabled();
      expect(enabled).toBe(true);
    });
  });
});

