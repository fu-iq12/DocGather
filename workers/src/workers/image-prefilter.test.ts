import { describe, it, expect, vi, beforeEach } from "vitest";
import { processImagePrefilterJob } from "./image-prefilter.js";

// Mock deps
vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  mkdtemp: vi.fn().mockResolvedValue("/tmp/test-dir"),
}));

vi.mock("../supabase.js", () => ({
  downloadFile: vi.fn().mockResolvedValue(Buffer.from("fake-image-data")),
}));

describe("Image Prefilter Worker", () => {
  let mockJob: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockJob = {
      data: {
        documentId: "doc-1",
        scaledImagePaths: ["path/to/image.webp"],
      },
      log: vi.fn(),
    };
  });

  it("should return hasText=true when Tesseract output is non-empty", async () => {
    const { execFile } = await import("child_process");
    (execFile as any).mockImplementation(
      (cmd: string, args: string[], cb: Function) => {
        cb(null, { stdout: "  Some detected text  \n", stderr: "" });
      },
    );

    const result = await processImagePrefilterJob(mockJob);

    expect(result.hasText).toBe(true);
    expect(result.rawText).toBe("Some detected text");
    expect(result.charCount).toBe(18);
  });

  it("should return hasText=false when Tesseract output is empty", async () => {
    const { execFile } = await import("child_process");
    (execFile as any).mockImplementation(
      (cmd: string, args: string[], cb: Function) => {
        cb(null, { stdout: "   \n\n  ", stderr: "" });
      },
    );

    const result = await processImagePrefilterJob(mockJob);

    expect(result.hasText).toBe(false);
    expect(result.charCount).toBe(0);
  });

  it("should handle empty scaledImagePaths gracefully", async () => {
    mockJob.data.scaledImagePaths = [];
    const result = await processImagePrefilterJob(mockJob);
    expect(result.hasText).toBe(false);
  });
});
