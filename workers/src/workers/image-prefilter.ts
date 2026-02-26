/**
 * Subtask processing unit for early text detection on images.
 * Determines if an image contains readable text using Tesseract before
 * dispatching it to the high-cost LLM Vision OCR pipeline.
 *
 * @see architecture/processing-workers.md - "Phase 9: Tesseract Filtering"
 */

import { Worker, Job } from "bullmq";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, rm, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join, extname } from "path";
import { connection } from "../queues.js";
import { downloadFile } from "../supabase.js";
import type { SubtaskInput, ImagePrefilterResult } from "../types.js";

const execFileAsync = promisify(execFile);

/**
 * Run Tesseract OCR on an image
 */
async function runTesseract(
  imagePath: string,
): Promise<{ text: string; charCount: number }> {
  const fileExtension = extname(imagePath);
  const pngImagePath = imagePath.replace(fileExtension, ".png");

  // Force the image to be grayscale (tesseract works better with grayscale images)
  await execFileAsync("magick", [
    imagePath,
    "-alpha",
    "off",
    "-colorspace",
    "Gray",
    "-depth",
    "8",
    "-strip",
    pngImagePath,
  ]);
  // Run tesseract <image> stdout -l eng+fra
  // "stdout" tells Tesseract to print to standard output instead of a file
  const { stdout } = await execFileAsync("tesseract", [
    pngImagePath,
    "stdout",
    "-l",
    "eng+fra", // English + French
    "--psm",
    "1", // Automatic page segmentation with OSD
  ]);

  const text = stdout.trim();
  return {
    text,
    charCount: text.length,
  };
}

/**
 * Image Pre-Filter job processor
 */
async function processImagePrefilterJob(
  job: Job<SubtaskInput>,
): Promise<ImagePrefilterResult> {
  const { documentId, scaledImagePaths } = job.data;

  // If no scaled images, nothing to filter.
  // (Should be handled upstream, but safe fallback)
  if (!scaledImagePaths || scaledImagePaths.length === 0) {
    console.warn(
      `[ImagePrefilter] No scaled images for document ${documentId}, returning hasText=false`,
    );
    return {
      hasText: false,
      rawText: "",
      charCount: 0,
    };
  }

  // Early-exit heuristic: testing the first scaled image suffices to establish text presence
  // without downloading the entire document or higher-resolution assets.

  const tempDir = await mkdtemp(join(tmpdir(), "img-prefilter-"));
  const inputImage = join(tempDir, "input.webp");

  try {
    // Resolve encrypted original/converted bytes from the remote bucket

    const buffer = await downloadFile(documentId, "llm_optimized");
    await writeFile(inputImage, Buffer.from(buffer));

    console.log(`[ImagePrefilter] processing ${documentId} with Tesseract...`);

    const { text, charCount } = await runTesseract(inputImage);

    // Permissive threshold: empty string (trace garbage removed by trim) means no text.
    // Anything else means text.
    const hasText = charCount > 0;

    console.log(
      `[ImagePrefilter] Doc ${documentId}: ${charCount} chars detected. hasText=${hasText}`,
    );

    return {
      hasText,
      rawText: text,
      charCount,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[ImagePrefilter] Failed for ${documentId}:`, errorMessage);
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Image Pre-Filter worker
 */
export const imagePrefilterWorker = new Worker<
  SubtaskInput,
  ImagePrefilterResult
>(
  "image-prefilter",
  async (job) => {
    return processImagePrefilterJob(job);
  },
  {
    connection,
    concurrency: 5,
  },
);

imagePrefilterWorker.on("completed", (job) => {
  console.log(`[ImagePrefilter] Job ${job.id} completed`);
});

imagePrefilterWorker.on("failed", (job, error) => {
  console.error(`[ImagePrefilter] Job ${job?.id} failed:`, error.message);
});

export { processImagePrefilterJob, runTesseract };
