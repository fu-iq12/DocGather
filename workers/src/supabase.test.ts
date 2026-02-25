/**
 * Tests for supabase.ts
 *
 * Tests write-back utilities with mocked Supabase client.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProcessingResults } from "./types.js";

// Set env vars before anything else
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SB_SECRET_KEY = "test-key";

// Create mock functions at module level
const mockRpc = vi.fn();
const mockUpload = vi.fn();
const mockDownload = vi.fn();
const mockCacheGet = vi.fn();
const mockCachePut = vi.fn();

// Mock Supabase client module
vi.mock("@supabase/supabase-js", () => {
  return {
    createClient: vi.fn(() => ({
      rpc: (...args: unknown[]) => mockRpc(...args),
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
      storage: {
        from: () => ({
          upload: (...args: unknown[]) => mockUpload(...args),
          download: (...args: unknown[]) => mockDownload(...args),
        }),
      },
    })),
  };
});

// Mock file cache module
vi.mock("./file-cache.js", () => {
  return {
    cacheGet: (...args: unknown[]) => mockCacheGet(...args),
    cachePut: (...args: unknown[]) => mockCachePut(...args),
    clearCacheForDocument: vi.fn().mockResolvedValue(undefined),
  };
});

// Import after mocking
const {
  writeBackResults,
  markDocumentFailed,
  downloadFile,
  uploadFile,
  parseToISODate,
  extractDatesFromNormalizedData,
} = await import("./supabase.js");

describe("supabase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCacheGet.mockResolvedValue(null); // Default to cache miss
    mockCachePut.mockResolvedValue(undefined);
  });

  describe("parseToISODate", () => {
    it("should parse YYYY-MM-DD", () => {
      expect(parseToISODate("2023-10-15")).toBe("2023-10-15");
      expect(parseToISODate("2023-10-15T10:00:00Z")).toBe("2023-10-15");
    });
    it("should pad YYYY-MM", () => {
      expect(parseToISODate("2023-10")).toBe("2023-10-01");
    });
    it("should pad YYYY", () => {
      expect(parseToISODate("2023")).toBe("2023-01-01");
    });
    it("should return null for invalid strings", () => {
      expect(parseToISODate("invalid")).toBeNull();
      expect(parseToISODate(null)).toBeNull();
      expect(parseToISODate(undefined)).toBeNull();
      expect(parseToISODate("")).toBeNull();
    });
  });

  describe("extractDatesFromNormalizedData", () => {
    it("should return nulls for empty/null data", () => {
      expect(extractDatesFromNormalizedData(null)).toEqual({
        documentDate: null,
        validFrom: null,
        validUntil: null,
      });
    });

    it("should extract from dates object", () => {
      expect(
        extractDatesFromNormalizedData({
          dates: { issueDate: "2023-01-05", expiryDate: "2033-01-05" },
        }),
      ).toEqual({
        documentDate: "2023-01-05",
        validFrom: "2023-01-05",
        validUntil: "2033-01-05",
      });
    });

    it("should extract from period structures (payPeriod)", () => {
      expect(
        extractDatesFromNormalizedData({
          payPeriod: { startDate: "2023-10-01", endDate: "2023-10-31" },
        }),
      ).toEqual({
        documentDate: "2023-10-31",
        validFrom: "2023-10-01",
        validUntil: "2023-10-31",
      });
    });

    it("should favor specific dates like billDate for documentDate", () => {
      expect(
        extractDatesFromNormalizedData({
          billDate: "2023-11-05",
          period: { startDate: "2023-10-01", endDate: "2023-10-31" },
        }),
      ).toEqual({
        documentDate: "2023-11-05",
        validFrom: "2023-10-01",
        validUntil: "2023-10-31",
      });
    });

    it("should parse fiscalYear into full year dates", () => {
      expect(
        extractDatesFromNormalizedData({
          fiscalYear: "2023",
        }),
      ).toEqual({
        documentDate: null,
        validFrom: "2023-01-01",
        validUntil: "2023-12-31",
      });
    });

    it("should parse academicYear correctly across two years", () => {
      expect(
        extractDatesFromNormalizedData({
          academicYear: "2023/2024",
        }),
      ).toEqual({
        documentDate: null,
        validFrom: "2023-09-01",
        validUntil: "2024-08-31",
      });
    });
  });

  describe("writeBackResults", () => {
    it("should call worker_update_document for classification", async () => {
      mockRpc.mockResolvedValue({ error: null });

      const results: ProcessingResults = {
        classification: {
          documentType: "income.payslip",
          extractionConfidence: 0.95,
          language: "fr",
        },
      };

      await writeBackResults("doc-123", results);

      // Should call worker_update_document with classification
      expect(mockRpc).toHaveBeenCalledWith(
        "worker_update_document",
        expect.objectContaining({
          p_document_id: "doc-123",
          p_document_type: "income.payslip",
          p_extraction_confidence: 0.95,
        }),
      );
    });

    it("should always call worker_mark_processing_complete with correct default status", async () => {
      mockRpc.mockResolvedValue({ error: null });

      const results: ProcessingResults = {};

      await writeBackResults("doc-123", results);

      expect(mockRpc).toHaveBeenCalledWith(
        "worker_mark_processing_complete",
        expect.objectContaining({
          p_document_id: "doc-123",
          p_final_status: "processed",
        }),
      );
    });

    it("should throw on RPC error", async () => {
      mockRpc.mockResolvedValue({ error: { message: "Database error" } });

      const results: ProcessingResults = {
        classification: {
          documentType: "income.payslip",
          extractionConfidence: 0.9,
          language: "fr",
        },
      };

      await expect(writeBackResults("doc-123", results)).rejects.toThrow(
        "worker_update_document failed",
      );
    });
  });

  describe("markDocumentFailed", () => {
    it("should call worker_mark_processing_complete with status=errored", async () => {
      mockRpc.mockResolvedValue({ error: null });

      await markDocumentFailed("doc-123", "Processing timeout", "v1.2.3");

      expect(mockRpc).toHaveBeenCalledWith(
        "worker_mark_processing_complete",
        expect.objectContaining({
          p_document_id: "doc-123",
          p_final_status: "errored",
          p_error_message: expect.stringContaining("Processing timeout"),
        }),
      );
    });

    it("should include worker version in error message", async () => {
      mockRpc.mockResolvedValue({ error: null });

      await markDocumentFailed("doc-123", "Error", "fly-v1.2.3");

      expect(mockRpc).toHaveBeenCalledWith(
        "worker_mark_processing_complete",
        expect.objectContaining({
          p_error_message: expect.stringContaining("fly-v1.2.3"),
        }),
      );
    });

    it("should not throw on RPC error (logs instead)", async () => {
      mockRpc.mockResolvedValue({ error: { message: "DB error" } });

      // Should not throw, just log
      await expect(
        markDocumentFailed("doc-123", "Error", "v1"),
      ).resolves.not.toThrow();
    });
  });

  describe("storage operations", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("downloadFile should return ArrayBuffer on success (Cache MISS)", async () => {
      const mockContent = new TextEncoder().encode("test content");
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockContent.buffer),
      });

      const result = await downloadFile("doc-123", "original");

      expect(result).toBeInstanceOf(ArrayBuffer);
      // Verify fetch called
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("storage-download"),
        expect.objectContaining({ method: "GET" }),
      );
      // Verify cache interaction
      expect(mockCacheGet).toHaveBeenCalledWith("doc-123", "original");
      expect(mockCachePut).toHaveBeenCalledWith(
        "doc-123",
        "original",
        result, // Should store the result
      );
    });

    it("downloadFile should return cached content on Cache HIT", async () => {
      const cachedContent = new TextEncoder().encode("cached content");
      mockCacheGet.mockResolvedValue(cachedContent.buffer);

      // Fetch should NOT be called
      global.fetch = vi.fn();

      const result = await downloadFile("doc-123", "original");

      expect(result).toEqual(cachedContent.buffer);
      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockCacheGet).toHaveBeenCalledWith("doc-123", "original");
    });

    it("downloadFile should throw on non-ok response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve("Not found"),
      });

      await expect(downloadFile("doc-123", "original")).rejects.toThrow(
        "Failed to download",
      );
    });

    it("uploadFile should return storage_path and content_hash", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            storage_path: "owner/doc-123/original.pdf",
            content_hash: "abc123",
          }),
      });

      const result = await uploadFile(
        "doc-123",
        "original",
        new ArrayBuffer(100),
        "application/pdf",
      );

      expect(result).toEqual({
        storage_path: "owner/doc-123/original.pdf",
        content_hash: "abc123",
      });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("storage-upload"),
        expect.objectContaining({ method: "POST" }),
      );
      // Verify cache interaction
      expect(mockCachePut).toHaveBeenCalledWith(
        "doc-123",
        "original",
        expect.any(ArrayBuffer),
      );
    });

    it("uploadFile should throw on error response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Server error"),
      });

      await expect(
        uploadFile(
          "doc-123",
          "original",
          new ArrayBuffer(100),
          "application/pdf",
        ),
      ).rejects.toThrow("Failed to upload");
    });
  });
});
