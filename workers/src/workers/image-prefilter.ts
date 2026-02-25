/**
 * Image Pre-Filter Worker
 *
 * Uses Tesseract OCR to cheaply filter out images containing no text
 * before the expensive LLM-OCR step.
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

  // We process the FIRST page/image only for the pre-filter check.
  // If the first page has text, we assume the document is valid for OCR.
  // (Most efficient strategy for multi-page scans where cover page usually has text)
  // TODO: Consider checking all pages if first page is empty?
  // For now, checking the first scaled image is sufficient.

  // We need to download the file from Supabase storage (it's encrypted)
  // scaledImagePaths contains the storage path, e.g. "llm_optimized/..."

  const tempDir = await mkdtemp(join(tmpdir(), "img-prefilter-"));
  const inputImage = join(tempDir, "input.webp");

  try {
    // scaledImagePaths is an array of storage paths.
    // The "role" (bucket folder) is implicitly handled by downloadFile if we pass the full path?
    // Wait, downloadFile expects (documentId, role).
    // Let's look at image-scaling.ts: it uploads to `llm_optimized`.
    // The path in scaledImagePaths is likely just the filename or relative path.
    // Let's double check how image-scaling returns it.
    // It returns `uploadResult.storage_path`.
    // Supabase storage path usually includes the folder.
    // `downloadFile` implementation in `supabase.ts` takes `role` (bucket folder basically).
    //
    // Let's assume we request the "llm_optimized" role for the file associated with this doc.
    // But wait, if there are multiple pages, how do we get the specific file?
    // `downloadFile` seems to get the *original* file by default or by role.
    //
    // Actually, `downloadFile` implementation:
    // async function downloadFile(documentId: string, role: string = "original"): Promise<Buffer>
    // It queries `document_files` table to find the file with that role.
    //
    // If we have multiple scaled images, they might all have role 'llm_optimized' but different page indices.
    // The current `downloadFile` likely fetches the *first* file with that role if we don't specify more.
    //
    // Since we only care about checking *some* text, checking the first available 'llm_optimized' file is fine.

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
    // On error (e.g. tesseract missing), fail open? Or fail job?
    // Let's fail the job so we see the error.
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
