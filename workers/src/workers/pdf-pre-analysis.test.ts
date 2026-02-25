/**
 * Tests for pdf-pre-analysis worker
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SubtaskInput } from "../types.js";

// Mock child_process
const mockExecFile = vi.fn();
vi.mock("child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

// Mock util.promisify to return our mock
vi.mock("util", () => ({
  promisify: () => mockExecFile,
}));

// Mock fs/promises
const mockWriteFile = vi.fn();
const mockRm = vi.fn();
const mockMkdtemp = vi.fn();
vi.mock("fs/promises", () => ({
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  rm: (...args: unknown[]) => mockRm(...args),
  mkdtemp: (...args: unknown[]) => mockMkdtemp(...args),
}));

// Mock supabase
const mockDownloadFile = vi.fn();
vi.mock("../supabase.js", () => ({
  downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
}));

// Mock queues
vi.mock("../queues.js", () => ({
  connection: {},
}));

// Import after mocking
const { processPdfPreAnalysisJob } = await import("./pdf-pre-analysis.js");

describe("pdf-pre-analysis worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdtemp.mockResolvedValue("/tmp/pdf-pre-123");
    mockWriteFile.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
  });

  describe("processPdfPreAnalysisJob", () => {
    it("should skip non-PDF documents", async () => {
      const job = {
        data: {
          documentId: "doc-123",
          ownerId: "user-456",
          mimeType: "image/jpeg",
          originalFileId: "file-789",
          originalPath: "path/to/file.jpg",
        } as SubtaskInput,
        name: "pdf-pre-analysis",
      };

      const result = await processPdfPreAnalysisJob(job as any);

      expect(result.pageCount).toBe(0);
      expect(result.textQuality).toBe("none");
      expect(mockDownloadFile).not.toHaveBeenCalled();
    });

    it("should analyze PDF with good text layer", async () => {
      mockDownloadFile.mockResolvedValue(new ArrayBuffer(100));
      mockExecFile.mockResolvedValue({
        stdout: JSON.stringify({
          isMultiDocument: false,
          documentCount: 1,
          pageCount: 5,
          hasTextLayer: true,
          textQuality: "good",
          language: "fr",
        }),
        stderr: "",
      });

      const job = {
        data: {
          documentId: "doc-123",
          ownerId: "user-456",
          mimeType: "application/pdf",
          originalFileId: "file-789",
          originalPath: "path/to/file.pdf",
        } as SubtaskInput,
        name: "pdf-pre-analysis",
      };

      const result = await processPdfPreAnalysisJob(job as any);

      expect(result.pageCount).toBe(5);
      expect(result.textQuality).toBe("good");
      expect(result.hasTextLayer).toBe(true);
      expect(result.language).toBe("fr");
      expect(result.isMultiDocument).toBe(false);
    });

    it("should detect multi-document PDFs", async () => {
      mockDownloadFile.mockResolvedValue(new ArrayBuffer(100));
      mockExecFile.mockResolvedValue({
        stdout: JSON.stringify({
          isMultiDocument: true,
          documentCount: 4,
          pageCount: 15,
          hasTextLayer: true,
          textQuality: "good",
          language: "en",
          documents: [
            { type: "document", pages: [0, 1, 2, 3] },
            { type: "document", pages: [4, 5] },
            { type: "full_page", pages: [6] },
            { type: "full_page", pages: [7] },
          ],
        }),
        stderr: "",
      });

      const job = {
        data: {
          documentId: "doc-123",
          ownerId: "user-456",
          mimeType: "application/pdf",
          originalFileId: "file-789",
          originalPath: "path/to/multi.pdf",
        } as SubtaskInput,
        name: "pdf-pre-analysis",
      };

      const result = await processPdfPreAnalysisJob(job as any);

      expect(result.isMultiDocument).toBe(true);
      expect(result.documentCount).toBe(4);
      expect(result.pageCount).toBe(15);
    });

    it("should handle PDFs with poor text layer", async () => {
      mockDownloadFile.mockResolvedValue(new ArrayBuffer(100));
      mockExecFile.mockResolvedValue({
        stdout: JSON.stringify({
          isMultiDocument: false,
          documentCount: 1,
          pageCount: 2,
          hasTextLayer: true,
          textQuality: "poor",
          language: "unknown",
        }),
        stderr: "",
      });

      const job = {
        data: {
          documentId: "doc-123",
          ownerId: "user-456",
          mimeType: "application/pdf",
          originalFileId: "file-789",
          originalPath: "path/to/scanned.pdf",
        } as SubtaskInput,
        name: "pdf-pre-analysis",
      };

      const result = await processPdfPreAnalysisJob(job as any);

      expect(result.textQuality).toBe("poor");
      expect(result.hasTextLayer).toBe(true);
    });

    it("should handle image-only PDFs (no text layer)", async () => {
      mockDownloadFile.mockResolvedValue(new ArrayBuffer(100));
      mockExecFile.mockResolvedValue({
        stdout: JSON.stringify({
          isMultiDocument: false,
          documentCount: 1,
          pageCount: 3,
          hasTextLayer: false,
          textQuality: "none",
          language: "unknown",
        }),
        stderr: "",
      });

      const job = {
        data: {
          documentId: "doc-123",
          ownerId: "user-456",
          mimeType: "application/pdf",
          originalFileId: "file-789",
          originalPath: "path/to/image-only.pdf",
        } as SubtaskInput,
        name: "pdf-pre-analysis",
      };

      const result = await processPdfPreAnalysisJob(job as any);

      expect(result.textQuality).toBe("none");
      expect(result.hasTextLayer).toBe(false);
    });

    it("should throw on Python script error", async () => {
      mockDownloadFile.mockResolvedValue(new ArrayBuffer(100));
      mockExecFile.mockResolvedValue({
        stdout: JSON.stringify({
          error: "Failed to open PDF",
        }),
        stderr: "",
      });

      const job = {
        data: {
          documentId: "doc-123",
          ownerId: "user-456",
          mimeType: "application/pdf",
          originalFileId: "file-789",
          originalPath: "path/to/corrupt.pdf",
        } as SubtaskInput,
        name: "pdf-pre-analysis",
      };

      await expect(processPdfPreAnalysisJob(job as any)).rejects.toThrow(
        "Python analysis failed",
      );
    });

    it("should cleanup temp files on success", async () => {
      mockDownloadFile.mockResolvedValue(new ArrayBuffer(100));
      mockExecFile.mockResolvedValue({
        stdout: JSON.stringify({
          isMultiDocument: false,
          documentCount: 1,
          pageCount: 1,
          hasTextLayer: false,
          textQuality: "none",
          language: "unknown",
        }),
        stderr: "",
      });

      const job = {
        data: {
          documentId: "doc-123",
          ownerId: "user-456",
          mimeType: "application/pdf",
          originalFileId: "file-789",
          originalPath: "path/to/file.pdf",
        } as SubtaskInput,
        name: "pdf-pre-analysis",
      };

      await processPdfPreAnalysisJob(job as any);

      expect(mockRm).toHaveBeenCalled();
    });
  });
});
