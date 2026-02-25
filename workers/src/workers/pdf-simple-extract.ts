/**
 * PDF Simple Extract Worker
 *
 * Extracts text from digital-native PDFs using Python/pdfplumber.
 * Only runs on PDFs that have been identified as having a "good" text layer
 * during the pre-analysis phase.
 */

import { Worker, Job } from "bullmq";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, rm, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { connection } from "../queues.js";
import { downloadFile } from "../supabase.js";
import type { SubtaskInput, PdfExtractResult } from "../types.js";

const execFileAsync = promisify(execFile);

const MAX_TXT_LENGTH = 50_000; // Cap at 50k chars to avoid LLM token explosions

// Path to Python script
const PYTHON_SCRIPT = join(
  process.cwd(),
  "processors",
  "python",
  "extract_text.py",
);

/**
 * Run the Python extraction script
 */
async function runPythonExtraction(pdfPath: string): Promise<PdfExtractResult> {
  const { stdout, stderr } = await execFileAsync("python", [
    PYTHON_SCRIPT,
    pdfPath,
  ]);

  if (stderr) {
    console.warn(`[PdfSimpleExtract] Python stderr: ${stderr}`);
  }

  const result = JSON.parse(stdout);

  if (result.error) {
    throw new Error(`Python extraction failed: ${result.error}`);
  }

  return result as PdfExtractResult;
}

/**
 * PDF text extraction job processor
 */
async function processPdfSimpleExtractJob(
  job: Job<SubtaskInput>,
): Promise<PdfExtractResult | null> {
  const { documentId, originalPath, mimeType, preAnalysis, convertedPdfPath } =
    job.data;

  // Basic validation: must be PDF or have a converted PDF
  if (mimeType !== "application/pdf" && !convertedPdfPath) {
    console.log(
      `[PdfSimpleExtract] Skipping non-PDF document ${documentId} (${mimeType})`,
    );
    return null; // Return null to indicate no result produced
  }

  console.log(`[PdfSimpleExtract] Extracting text from ${documentId}`);

  // Create temp directory
  const tempDir = await mkdtemp(join(tmpdir(), "pdf-extract-"));
  const pdfPath = join(tempDir, "input.pdf");

  try {
    // Download PDF (decrypted via edge function)
    const isConvertedPdf = !!convertedPdfPath;
    const buffer = await downloadFile(
      documentId,
      isConvertedPdf ? "converted_pdf" : "original",
    );
    await writeFile(pdfPath, Buffer.from(buffer));

    // Run extraction
    const result = await runPythonExtraction(pdfPath);

    if (result.text && result.text.length > MAX_TXT_LENGTH) {
      console.warn(
        `[PdfSimpleExtract] Truncating text for ${documentId} from ${result.text.length} to ${MAX_TXT_LENGTH} characters.`,
      );
      result.text =
        result.text.substring(0, MAX_TXT_LENGTH) + "\n\n...[TRUNCATED]";
    }

    console.log(
      `[PdfSimpleExtract] Extracted ${result.text.length} chars from ${result.pageCount} pages for ${documentId}`,
    );

    return result;
  } catch (error) {
    console.error(`[PdfSimpleExtract] Failed for ${documentId}:`, error);
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * PDF simple extract worker
 */
export const pdfSimpleExtractWorker = new Worker<
  SubtaskInput,
  PdfExtractResult | null
>(
  "pdf-simple-extract",
  async (job) => {
    return processPdfSimpleExtractJob(job);
  },
  {
    connection,
    concurrency: 5,
  },
);

pdfSimpleExtractWorker.on("completed", (job) => {
  console.log(`[PdfSimpleExtract] Job ${job.id} completed`);
});

pdfSimpleExtractWorker.on("failed", (job, error) => {
  console.error(`[PdfSimpleExtract] Job ${job?.id} failed:`, error.message);
});

export { processPdfSimpleExtractJob, runPythonExtraction };
