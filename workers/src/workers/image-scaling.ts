/**
 * Subtask processing unit responsible for normalizing image dimensions and formats
 * for cost-optimized LLM Vision processing (Max 1280px, WebP format).
 * Uses ImageMagick locally and dispatches to python pipelines for PDF to Image extractions.
 *
 * @see architecture/processing-workers.md - "Phase 6 & 8: Scaling & Conversion"
 */

import { Worker, Job } from "bullmq";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, rm, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { connection } from "../queues.js";
import { downloadFile, uploadFile } from "../supabase.js";
import type { SubtaskInput, ImageScalingResult } from "../types.js";
import { getDefaultConfig } from "../llm/types.js";

const execFileAsync = promisify(execFile);

const MAX_DIMENSION = 1280;
const WEBP_QUALITY = 85;

/**
 * Get image dimensions using ImageMagick identify
 */
async function getImageDimensions(
  filePath: string,
): Promise<{ width: number; height: number }> {
  const { stdout } = await execFileAsync("magick", [
    "identify",
    "-format",
    "%w %h",
    `${filePath}[0]`, // First frame only (for animated/multi-page)
  ]);

  const [width, height] = stdout.trim().split(" ").map(Number);
  return { width: width || 0, height: height || 0 };
}

/**
 * Scale an image using ImageMagick
 *
 * - Resize to max 1280px on longest side (no upscaling)
 * - Convert to WebP
 * - Return dimensions and file size
 */
async function scaleImageWithMagick(
  inputPath: string,
  outputPath: string,
): Promise<{ width: number; height: number; fileSize: number }> {
  // Degrade quality automatically to constrain resulting file size to safe margins
  let outputBuffer!: Buffer;

  for (let quality = WEBP_QUALITY; quality >= 5; quality -= 5) {
    await execFileAsync("magick", [
      inputPath,
      "-resize",
      `${MAX_DIMENSION}x${MAX_DIMENSION}>`,
      "-quality",
      String(quality),
      outputPath,
    ]);

    outputBuffer = await readFile(outputPath);
    if (outputBuffer.length < 120 * 1024) {
      break;
    }
  }

  // Get output dimensions and size
  const dimensions = await getImageDimensions(outputPath);

  return {
    ...dimensions,
    fileSize: outputBuffer.length,
  };
}

/**
 * Scale an image and create document_files entry
 */
async function scaleImage(
  documentId: string,
  ownerId: string,
  originalFileRole: string,
  pageIndex: number,
): Promise<{
  scaledPath: string;
  originalDimensions: { width: number; height: number };
  scaledDimensions: { width: number; height: number };
  fileSize: number;
}> {
  // Create temp directory for processing
  const tempDir = await mkdtemp(join(tmpdir(), "img-scale-"));
  const inputFile = join(tempDir, "input");
  const outputFile = join(tempDir, "output.webp");

  try {
    // Download original file (decrypted via edge function)
    const buffer = await downloadFile(documentId, originalFileRole);
    await writeFile(inputFile, Buffer.from(buffer));

    // Get original dimensions
    const originalDimensions = await getImageDimensions(inputFile);

    // Scale image
    const { width, height, fileSize } = await scaleImageWithMagick(
      inputFile,
      outputFile,
    );
    const scaledDimensions = { width, height };

    // Read scaled file and upload (automatically encrypted in transit via Edge Function)
    const scaledBuffer = await readFile(outputFile);
    const scaledFileRole = `llm_optimized`;
    const uploadResult = await uploadFile(
      documentId,
      scaledFileRole,
      scaledBuffer,
      "image/webp",
    );
    const scaledPath = uploadResult.storage_path;

    console.log(
      `[ImageScaling] ${originalDimensions.width}x${originalDimensions.height} → ${scaledDimensions.width}x${scaledDimensions.height} (${fileSize} bytes)`,
    );

    return {
      scaledPath,
      originalDimensions,
      scaledDimensions,
      fileSize,
    };
  } catch (error) {
    console.error(`[ImageScaling] Error scaling image: ${error}`);
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

const PYTHON_PDF_SCRIPT = join(
  process.cwd(),
  "processors",
  "python",
  "pdf_to_image.py",
);

/**
 * Run Python PDF-to-Image conversion
 */
async function runPdfToImage(
  pdfPath: string,
  outputDir: string,
): Promise<{
  scaledPath: string;
  originalDimensions: { width: number; height: number };
  scaledDimensions: { width: number; height: number };
  fileSize: number;
}> {
  const config = getDefaultConfig();
  const { stdout, stderr } = await execFileAsync("python", [
    PYTHON_PDF_SCRIPT,
    pdfPath,
    "--output_dir",
    outputDir,
    "--size",
    config.vision.provider === "mistral-ocr" ? "0" : "1280",
  ]);

  if (stderr) {
    console.warn(`[ImageScaling] Python stderr: ${stderr}`);
  }

  try {
    const result = JSON.parse(stdout);
    if (result.error) {
      throw new Error(result.error);
    }
    return {
      scaledPath: result.scaledPath,
      originalDimensions: result.originalDimensions,
      scaledDimensions: result.scaledDimensions,
      fileSize: result.fileSize,
    };
  } catch (e) {
    throw new Error(`Failed to parse Python output: ${stdout}`);
  }
}

/**
 * Scale a PDF page (page 1) to image
 */
async function scalePdfPage(
  documentId: string,
  ownerId: string,
  originalFileRole: string,
): Promise<{
  scaledPath: string;
  originalDimensions: { width: number; height: number };
  scaledDimensions: { width: number; height: number };
  fileSize: number;
}> {
  const tempDir = await mkdtemp(join(tmpdir(), "pdf-scale-"));
  const inputPdf = join(tempDir, "input.pdf");

  try {
    const buffer = await downloadFile(documentId, originalFileRole);
    await writeFile(inputPdf, Buffer.from(buffer));

    const result = await runPdfToImage(inputPdf, tempDir);

    // Read result and upload (encrypted via edge function)
    const scaledBuffer = await readFile(result.scaledPath);
    const scaledFileRole = `llm_optimized`;
    const uploadResult = await uploadFile(
      documentId,
      scaledFileRole,
      scaledBuffer,
      "image/webp",
    );
    const storagePath = uploadResult.storage_path;

    console.log(
      `[ImageScaling] PDF → WebP: ${result.scaledDimensions.width}x${result.scaledDimensions.height} (${scaledBuffer.length} bytes)`,
    );

    return {
      ...result,
      scaledPath: storagePath,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Processes incoming documents based on their MIME type, triggering the scale sequence
 * or PDF layout extraction sequence. Records paths back into 'document_files'.
 */
async function processImageScalingJob(
  job: Job<SubtaskInput>,
): Promise<ImageScalingResult> {
  const { documentId, ownerId, originalPath, mimeType } = job.data;

  console.log(`[ImageScaling] Processing document ${documentId} (${mimeType})`);

  try {
    let result;

    if (mimeType === "application/pdf") {
      result = await scalePdfPage(documentId, ownerId, "original");
    } else {
      result = await scaleImage(documentId, ownerId, "original", 0);
    }

    return {
      scaledPaths: [result.scaledPath],
      originalDimensions: [result.originalDimensions],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[ImageScaling] Failed for ${documentId}:`, errorMessage);
    throw error;
  }
}

/**
 * Image scaling worker
 *
 * Listens on "tasks" queue for "image-scaling" jobs.
 */
export const imageScalingWorker = new Worker<SubtaskInput, ImageScalingResult>(
  "image-scaling",
  async (job) => {
    console.log(`[ImageScaling] Job ${job.name} (${job.id}) received`);
    return processImageScalingJob(job);
  },
  {
    connection,
    concurrency: 3,
  },
);

imageScalingWorker.on("completed", (job) => {
  console.log(`[ImageScaling] Job ${job?.id} completed`);
});

imageScalingWorker.on("failed", (job, error) => {
  console.error(`[ImageScaling] Job ${job?.id} failed:`, error.message);
});

export {
  scaleImage,
  processImageScalingJob,
  getImageDimensions,
  scaleImageWithMagick,
};
