/**
 * Validation Suite: pdf-splitter
 * Tests the pdf-splitter module for expected architectural behaviors and edge cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SubtaskInput } from "../types.js";

// Use vi.hoisted to define mocks that can be used inside vi.mock factory
const mocks = vi.hoisted(() => ({
  mkdtemp: vi.fn(),
  rm: vi.fn(),
  load: vi.fn(),
  create: vi.fn(),
  save: vi.fn(),
  copyPages: vi.fn(),
  addPage: vi.fn(),
  downloadFile: vi.fn(),
  uploadFile: vi.fn(),
  createChildDocument: vi.fn(),
  updateDocumentPrivate: vi.fn(),
  queueAdd: vi.fn(),
}));

// Mock pdf-lib
vi.mock("pdf-lib", () => ({
  PDFDocument: {
    load: (...args: unknown[]) => mocks.load(...args),
    create: (...args: unknown[]) => mocks.create(...args),
  },
}));

// Mock fs/promises
vi.mock("fs/promises", () => ({
  mkdtemp: (...args: unknown[]) => mocks.mkdtemp(...args),
  rm: (...args: unknown[]) => mocks.rm(...args),
}));

vi.mock("../supabase.js", () => ({
  downloadFile: (...args: unknown[]) => mocks.downloadFile(...args),
  uploadFile: (...args: unknown[]) => mocks.uploadFile(...args),
  createChildDocument: (...args: unknown[]) =>
    mocks.createChildDocument(...args),
  updateDocumentPrivate: (...args: unknown[]) =>
    mocks.updateDocumentPrivate(...args),
}));

// Mock queues
vi.mock("bullmq", () => ({
  Worker: class {
    on() {}
    close() {}
  },
  Queue: class {
    add(...args: unknown[]) {
      return mocks.queueAdd(...args);
    }
  },
}));

vi.mock("../queues.js", () => ({
  connection: {},
}));

// Import after mocking
const { processPdfSplitterJob } = await import("./pdf-splitter.js");

describe("pdf-splitter worker", () => {
  const mockPDFInstance = {
    copyPages: mocks.copyPages,
    addPage: mocks.addPage,
    save: mocks.save,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock behaviors
    mocks.mkdtemp.mockResolvedValue("/tmp/pdf-split-123");
    mocks.rm.mockResolvedValue(undefined); // rm returns promise<void>

    mocks.load.mockResolvedValue(mockPDFInstance);
    mocks.create.mockResolvedValue(mockPDFInstance);

    // Return a mock page object instead of a string
    const defaultMockPage = {
      getMediaBox: vi
        .fn()
        .mockReturnValue({ x: 0, y: 0, width: 100, height: 100 }),
      setCropBox: vi.fn(),
    };
    mocks.copyPages.mockResolvedValue([defaultMockPage]);

    mocks.save.mockResolvedValue(new Uint8Array(10));

    mocks.createChildDocument.mockResolvedValue("child-doc-123");
    mocks.downloadFile.mockResolvedValue(new ArrayBuffer(100));
    mocks.uploadFile.mockResolvedValue({ storage_path: "mock/path" });
    mocks.updateDocumentPrivate.mockResolvedValue(undefined);
  });

  describe("processPdfSplitterJob", () => {
    it("should skip non-PDF documents", async () => {
      const job = {
        data: {
          documentId: "doc-123",
          ownerId: "user-456",
          mimeType: "image/jpeg",
          originalFileId: "file-789",
          originalPath: "path/to/file.jpg",
        } as SubtaskInput,
        name: "pdf-splitter",
      };

      const result = await processPdfSplitterJob(job as any);

      expect(result).toBeNull();
      expect(mocks.downloadFile).not.toHaveBeenCalled();
    });

    it("should skip single-document PDFs", async () => {
      const job = {
        data: {
          documentId: "doc-123",
          ownerId: "user-456",
          mimeType: "application/pdf",
          originalFileId: "file-789",
          originalPath: "path/to/file.pdf",
          preAnalysis: {
            isMultiDocument: false,
            documentCount: 1,
            pageCount: 1,
            hasTextLayer: true,
            textQuality: "good",
            language: "en",
          },
        } as SubtaskInput,
        name: "pdf-splitter",
      };

      const result = await processPdfSplitterJob(job as any);

      expect(result).toBeNull();
      expect(mocks.downloadFile).not.toHaveBeenCalled();
    });

    it("should split multi-document PDF", async () => {
      const job = {
        data: {
          documentId: "parent-doc",
          ownerId: "user-456",
          mimeType: "application/pdf",
          originalFileId: "file-789",
          originalPath: "path/to/parent.pdf",
          preAnalysis: {
            isMultiDocument: true,
            documentCount: 2,
            pageCount: 3,
            hasTextLayer: true,
            textQuality: "good",
            language: "en",
            documents: [
              { type: "doc1", pages: [0, 1], hint: "" },
              { type: "doc2", pages: [2], hint: "" },
            ],
          },
        } as SubtaskInput,
        name: "pdf-splitter",
      };

      const result = await processPdfSplitterJob(job as any);

      expect(result).not.toBeNull();
      expect(result?.splitInto).toBe(2);
      expect(result?.childDocumentIds).toHaveLength(2);

      // Verify Supabase calls
      expect(mocks.createChildDocument).toHaveBeenCalledTimes(2);
      expect(mocks.createChildDocument).toHaveBeenCalledWith(
        "parent-doc",
        "user-456",
        { pages: [0, 1], type: "doc1" },
        "doc1",
      );
      expect(mocks.createChildDocument).toHaveBeenCalledWith(
        "parent-doc",
        "user-456",
        { pages: [2], type: "doc2" },
        "doc2",
      );

      expect(mocks.updateDocumentPrivate).toHaveBeenCalledTimes(2);

      expect(mocks.uploadFile).toHaveBeenCalledTimes(2);

      // Verify orchestrator trigger
      expect(mocks.queueAdd).toHaveBeenCalledTimes(2);
      expect(mocks.queueAdd).toHaveBeenCalledWith(
        "process-document",
        expect.objectContaining({ ownerId: "user-456" }),
        expect.anything(),
      );

      // Verify cleanup
      expect(mocks.rm).toHaveBeenCalled();
    });

    it("should skip if preAnalysis.documents is empty", async () => {
      const job = {
        data: {
          documentId: "doc-123",
          ownerId: "user-456",
          mimeType: "application/pdf",
          originalFileId: "file-789",
          originalPath: "path/to/file.pdf",
          preAnalysis: {
            isMultiDocument: true,
            documentCount: 0,
            pageCount: 1,
            hasTextLayer: true,
            textQuality: "good",
            language: "en",
            documents: [],
          },
        } as SubtaskInput,
        name: "pdf-splitter",
      };

      const result = await processPdfSplitterJob(job as any);

      expect(result).toBeNull();
      expect(mocks.downloadFile).not.toHaveBeenCalled();
    });

    it("should apply cropping for split pages", async () => {
      // Mock page object with getMediaBox and setCropBox
      const mockPage = {
        getMediaBox: vi
          .fn()
          .mockReturnValue({ x: 0, y: 0, width: 595, height: 842 }),
        setCropBox: vi.fn(),
        setMediaBox: vi.fn(),
      };

      // Override copyPages for this test only
      mocks.copyPages.mockResolvedValue([mockPage]);

      const job = {
        data: {
          documentId: "doc-crop-123",
          ownerId: "user-456",
          mimeType: "application/pdf",
          originalFileId: "file-789",
          originalPath: "path/to/source.pdf",
          preAnalysis: {
            isMultiDocument: true,
            documentCount: 2,
            hasTextLayer: true,
            textQuality: "good",
            language: "en",
            documents: [
              { type: "top_half", pages: [0] },
              { type: "bottom_half", pages: [0] },
            ],
          },
        } as SubtaskInput,
        name: "pdf-splitter",
      };

      // Call the function
      await processPdfSplitterJob(job as any);

      // Verify cropping logic was applied
      expect(mockPage.getMediaBox).toHaveBeenCalledTimes(2); // Once for each split

      // Top half crop check: y + height/2 = 421
      expect(mockPage.setCropBox).toHaveBeenCalledWith(0, 421, 595, 421);
      expect(mockPage.setMediaBox).toHaveBeenCalledWith(0, 421, 595, 421);

      // Bottom half crop check: y = 0
      expect(mockPage.setCropBox).toHaveBeenCalledWith(0, 0, 595, 421);
      expect(mockPage.setMediaBox).toHaveBeenCalledWith(0, 0, 595, 421);
    });
  });
});

