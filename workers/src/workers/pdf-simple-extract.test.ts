/**
 * Tests for pdf-simple-extract worker
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SubtaskInput } from "../types.js";

// Mock child_process
const mockExecFile = vi.fn();
vi.mock("child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

// Mock util.promisify
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
const { processPdfSimpleExtractJob } = await import("./pdf-simple-extract.js");

describe("pdf-simple-extract worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdtemp.mockResolvedValue("/tmp/pdf-extract-123");
    mockWriteFile.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
  });

  describe("processPdfSimpleExtractJob", () => {
    it("should skip non-PDF documents", async () => {
      const job = {
        data: {
          documentId: "doc-123",
          mimeType: "image/jpeg",
        } as SubtaskInput,
        name: "pdf-simple-extract",
      };

      const result = await processPdfSimpleExtractJob(job as any);

      expect(result).toBeNull();
      expect(mockDownloadFile).not.toHaveBeenCalled();
    });

    it("should extract text from good PDF", async () => {
      mockDownloadFile.mockResolvedValue(new ArrayBuffer(100));
      mockExecFile.mockResolvedValue({
        stdout: JSON.stringify({
          text: "Extracted content...",
          pageCount: 5,
          hasTextLayer: true,
          textQuality: "good",
        }),
        stderr: "",
      });

      const job = {
        data: {
          documentId: "doc-123",
          originalPath: "path/to/doc.pdf",
          mimeType: "application/pdf",
          preAnalysis: {
            textQuality: "good",
            isMultiDocument: false,
            pageCount: 5,
          },
        } as SubtaskInput,
        name: "pdf-simple-extract",
      };

      const result = await processPdfSimpleExtractJob(job as any);

      expect(result).not.toBeNull();
      expect(result?.text).toBe("Extracted content...");
      expect(result?.pageCount).toBe(5);
      expect(mockExecFile).toHaveBeenCalled();
    });

    it("should process if preAnalysis is missing (optimistic)", async () => {
      mockDownloadFile.mockResolvedValue(new ArrayBuffer(100));
      mockExecFile.mockResolvedValue({
        stdout: JSON.stringify({
          text: "Content",
          pageCount: 1,
          hasTextLayer: true,
          textQuality: "good",
        }),
        stderr: "",
      });

      const job = {
        data: {
          documentId: "doc-123",
          originalPath: "path/to/doc.pdf",
          mimeType: "application/pdf",
          // No preAnalysis
        } as SubtaskInput,
        name: "pdf-simple-extract",
      };

      const result = await processPdfSimpleExtractJob(job as any);

      expect(result).not.toBeNull();
      expect(mockExecFile).toHaveBeenCalled();
    });

    it("should handle Python script errors", async () => {
      mockDownloadFile.mockResolvedValue(new ArrayBuffer(100));
      mockExecFile.mockResolvedValue({
        stdout: JSON.stringify({
          error: "Corrupt PDF",
        }),
        stderr: "",
      });

      const job = {
        data: {
          documentId: "doc-123",
          originalPath: "path/to/bad.pdf",
          mimeType: "application/pdf",
        } as SubtaskInput,
        name: "pdf-simple-extract",
      };

      await expect(processPdfSimpleExtractJob(job as any)).rejects.toThrow(
        "Python extraction failed",
      );
    });
  });
});
