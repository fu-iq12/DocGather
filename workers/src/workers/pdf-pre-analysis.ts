/**
 * PDF Pre-Analysis Worker
 *
 * Performs quick analysis of PDFs to determine:
 * - Page count
 * - Text layer quality (good/poor/none)
 * - Language detection
 * - Multi-document hints
 *
 * Uses Python/pdfplumber for reliable PDF parsing.
 */

import { Worker, Job } from "bullmq";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, rm, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { connection } from "../queues.js";
import { downloadFile } from "../supabase.js";
import type { SubtaskInput, PreAnalysisResult } from "../types.js";

const execFileAsync = promisify(execFile);

// Path to Python script (relative to workers root when running in Docker)
const PYTHON_SCRIPT = join(
  process.cwd(),
  "processors",
  "python",
  "pre_analyze.py",
);

/**
 * Run the Python pre-analysis script
 */
async function runPythonAnalysis(pdfPath: string): Promise<PreAnalysisResult> {
  const { stdout, stderr } = await execFileAsync("python", [
    PYTHON_SCRIPT,
    pdfPath,
  ]);

  if (stderr) {
    console.warn(`[PdfPreAnalysis] Python stderr: ${stderr}`);
  }

  const result = JSON.parse(stdout);

  // Handle Python script errors
  if (result.error) {
    throw new Error(`Python analysis failed: ${result.error}`);
  }

  return result as PreAnalysisResult;
}

/**
 * PDF pre-analysis job processor
 */
async function processPdfPreAnalysisJob(
  job: Job<SubtaskInput>,
): Promise<PreAnalysisResult> {
  const { documentId, originalPath, mimeType, convertedPdfPath } = job.data;

  // Verify this is a PDF or was converted to one
  if (mimeType !== "application/pdf" && !convertedPdfPath) {
    console.log(
      `[PdfPreAnalysis] Skipping non-PDF document ${documentId} (${mimeType})`,
    );
    return {
      isMultiDocument: false,
      documentCount: 0,
      pageCount: 0,
      hasTextLayer: false,
      textQuality: "none",
      language: "unknown",
    };
  }

  console.log(`[PdfPreAnalysis] Analyzing document ${documentId}`);

  // Create temp directory for processing
  const tempDir = await mkdtemp(join(tmpdir(), "pdf-pre-"));
  const pdfPath = join(tempDir, "input.pdf");

  try {
    // Download PDF to temp file (decrypted via edge function)
    // If convertedPdfPath is present, it means the document was converted from another format.
    // In that case, we need to download the converted_pdf variant instead of the original.
    const fileRole = convertedPdfPath ? "converted_pdf" : "original";
    const buffer = await downloadFile(documentId, fileRole);
    await writeFile(pdfPath, Buffer.from(buffer));

    // Run Python analysis
    const result = await runPythonAnalysis(pdfPath);

    console.log(
      `[PdfPreAnalysis] Document ${documentId}: ${result.pageCount} pages, ` +
        `text=${result.textQuality}, lang=${result.language}` +
        (result.isMultiDocument ? ` (multi-doc: ${result.documentCount})` : ""),
    );

    return result;
  } finally {
    // Cleanup temp file
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * PDF pre-analysis worker
 */
export const pdfPreAnalysisWorker = new Worker<SubtaskInput, PreAnalysisResult>(
  "pdf-pre-analysis",
  async (job) => {
    return processPdfPreAnalysisJob(job);
  },
  {
    connection,
    concurrency: 5, // PDF analysis is quick, can run more concurrently
  },
);

pdfPreAnalysisWorker.on("completed", (job) => {
  console.log(`[PdfPreAnalysis] Job ${job.id} completed`);
});

pdfPreAnalysisWorker.on("failed", (job, error) => {
  console.error(`[PdfPreAnalysis] Job ${job?.id} failed:`, error.message);
});

export { processPdfPreAnalysisJob, runPythonAnalysis };
