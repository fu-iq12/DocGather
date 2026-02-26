/**
 * Validation Suite: image-scaling
 * Tests the image-scaling module for expected architectural behaviors and edge cases.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SubtaskInput } from "../types.js";

// Mock child_process
const mockExecFile = vi.fn();
vi.mock("child_process", () => ({
  execFile: (
    cmd: string,
    args: string[],
    callback: (err: Error | null, result: { stdout: string }) => void,
  ) => mockExecFile(cmd, args, callback),
}));

// Mock fs/promises
const mockWriteFile = vi.fn();
const mockReadFile = vi.fn();
const mockRm = vi.fn();
const mockMkdtemp = vi.fn();

vi.mock("fs/promises", () => ({
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  rm: (...args: unknown[]) => mockRm(...args),
  mkdtemp: (...args: unknown[]) => mockMkdtemp(...args),
}));

// Mock supabase
const mockDownloadFile = vi.fn();
const mockUploadFile = vi.fn();

vi.mock("../supabase.js", () => ({
  downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
  uploadFile: (...args: unknown[]) => mockUploadFile(...args),
}));

// Mock queues
vi.mock("../queues.js", () => ({
  connection: {},
}));

// Import after mocking
const { processImageScalingJob } = await import("./image-scaling.js");

/**
 * Helper: set up the standard execFile mock that handles:
 * - magick identify → returns dimensions
 * - magick convert → succeeds
 * - python detect_orientation.py → returns orientation result
 * - magick -rotate → succeeds (rotation applied)
 */
function setupExecFileMock(options: {
  dimensions?: string;
  orientationResult?: {
    rotation: number;
    confidence: number;
    scores?: Record<string, number>;
  };
  orientationError?: string;
}) {
  const {
    dimensions = "2000 3000",
    orientationResult = {
      rotation: 0,
      confidence: 0.9,
      scores: { "0": 0.9, "90": 0.3, "180": 0.2, "270": 0.1 },
    },
    orientationError,
  } = options;

  mockExecFile.mockImplementation(
    (
      cmd: string,
      args: string[],
      callback: (
        err: Error | null,
        result: { stdout: string; stderr?: string },
      ) => void,
    ) => {
      if (cmd === "python") {
        // Orientation detection script
        if (orientationError) {
          callback(new Error(orientationError), { stdout: "" });
        } else {
          callback(null, { stdout: JSON.stringify(orientationResult) });
        }
      } else if (args.includes("identify")) {
        // ImageMagick identify → return dimensions
        callback(null, { stdout: dimensions });
      } else if (args.includes("-rotate")) {
        // ImageMagick rotate → succeed
        callback(null, { stdout: "" });
      } else {
        // ImageMagick convert → succeed
        callback(null, { stdout: "" });
      }
    },
  );
}

describe("image-scaling worker (ImageMagick)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    mockMkdtemp.mockResolvedValue("/tmp/img-scale-abc123");
    mockWriteFile.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
  });

  describe("processImageScalingJob", () => {
    it("should process image using ImageMagick", async () => {
      // Setup mocks
      mockDownloadFile.mockResolvedValue(new ArrayBuffer(1000));
      setupExecFileMock({ dimensions: "2000 3000" });

      // Mock reading the output file
      // Mock reading the output file
      mockReadFile.mockResolvedValue(Buffer.from("scaled-webp-content"));
      mockUploadFile.mockResolvedValue({
        storage_path: "path/to/scaled_0.webp",
        content_hash: "hash",
      });

      const job = {
        data: {
          documentId: "doc-123",
          ownerId: "user-456",
          mimeType: "image/jpeg",
          originalFileId: "file-orig-123",
          originalPath: "path/to/photo.jpg",
        } as SubtaskInput,
        name: "image-scaling",
      };

      const result = await processImageScalingJob(job as any);

      expect(result.scaledPaths).toHaveLength(1);
      expect(result.scaledPaths[0]).toContain("scaled_0.webp");

      // Verify ImageMagick was called
      expect(mockExecFile).toHaveBeenCalled();

      // Verify document_files entry was created
      // Verify document_files entry was created (implicitly by storage-upload)
      // Note: createDocumentFile call has been moved to the edge function

      // Verify temp files were cleaned up
      expect(mockRm).toHaveBeenCalled();
    });

    it("should handle ImageMagick errors gracefully", async () => {
      mockDownloadFile.mockResolvedValue(new ArrayBuffer(100));

      // Mock execFile to fail
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          callback: (err: Error | null, result: { stdout: string }) => void,
        ) => {
          callback(new Error("ImageMagick: unsupported format"), {
            stdout: "",
          });
        },
      );

      const job = {
        data: {
          documentId: "doc-123",
          ownerId: "user-456",
          mimeType: "image/unknown",
          originalFileId: "file-123",
          originalPath: "file.weird",
        } as SubtaskInput,
        name: "image-scaling",
      };

      await expect(processImageScalingJob(job as any)).rejects.toThrow();

      // Verify cleanup was still attempted
      expect(mockRm).toHaveBeenCalled();
    });

    it("should support various image formats via ImageMagick", async () => {
      // ImageMagick supports: JPEG, PNG, WebP, HEIC, TIFF, PSD, RAW, etc.
      const formats = [
        { mime: "image/heic", ext: "heic" },
        { mime: "image/tiff", ext: "tiff" },
        { mime: "image/x-adobe-dng", ext: "dng" },
      ];

      for (const format of formats) {
        vi.clearAllMocks();
        mockMkdtemp.mockResolvedValue("/tmp/img-scale-test");
        mockDownloadFile.mockResolvedValue(new ArrayBuffer(100));
        setupExecFileMock({ dimensions: "500 500" });
        mockReadFile.mockResolvedValue(Buffer.from("x"));
        mockUploadFile.mockResolvedValue({
          storage_path: "path/to/scaled_0.webp",
          content_hash: "hash",
        });

        const job = {
          data: {
            documentId: "doc",
            ownerId: "user",
            mimeType: format.mime,
            originalFileId: "file-123",
            originalPath: `file.${format.ext}`,
          } as SubtaskInput,
          name: "image-scaling",
        };

        const result = await processImageScalingJob(job as any);
        expect(result.scaledPaths.length).toBe(1);
      }
    });
  });
});

