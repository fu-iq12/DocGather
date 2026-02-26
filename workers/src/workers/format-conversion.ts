/**
 * Subtask processing unit responsible for standardizing incoming anomalous file types
 * (emails, legacy spreadsheets, XPS) into standard PDF formats or raw extracted text.
 * Falls back to python extraction pipelines for spreadsheets and emails.
 *
 * @see architecture/processing-workers.md - "Phase 3: Format Conversion"
 */
import { Job, Worker } from "bullmq";
import { type SubtaskInput, type FormatConversionResult } from "../types.js";
import { downloadFile, uploadFile } from "../supabase.js";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { connection } from "../queues.js";
import {
  isEmail,
  isNativeSpreadsheet,
  isSpreadsheet,
  isXps,
} from "../utils/mime-types.js";

const execFileAsync = promisify(execFile);

const processor = async (job: Job<SubtaskInput, FormatConversionResult>) => {
  const { documentId, originalPath, ownerId } = job.data;

  // Allocate ephemeral processing directory
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `convert-${documentId}-`),
  );
  const inputFile = path.join(
    tempDir,
    `original-${documentId}${path.extname(originalPath)}`,
  );

  // libreoffice requires an output directory, it uses the input filename + .pdf
  const outputFileName = `original-${documentId}.pdf`;
  const outputFile = path.join(tempDir, outputFileName);

  try {
    console.log(`[ConvertToPDF] Downloading original for ${documentId}...`);
    const buffer = await downloadFile(documentId, "original");
    await fs.writeFile(inputFile, Buffer.from(buffer));

    let finalPdfPath = outputFile;

    if (isSpreadsheet(job.data.mimeType)) {
      console.log(
        `[FormatConversion] Extracting spreadsheet data for ${documentId}...`,
      );
      let spreadsheetFile = inputFile;

      // Convert legacy/other formats to xlsx first
      if (!isNativeSpreadsheet(job.data.mimeType)) {
        console.log(
          `[FormatConversion] Converting ${job.data.mimeType} to XLSX via libreoffice...`,
        );
        const { stdout, stderr } = await execFileAsync("soffice", [
          "--headless",
          "--convert-to",
          "xlsx",
          "--outdir",
          tempDir,
          inputFile,
        ]);
        if (stderr && stderr.trim() !== "") {
          console.warn(`[FormatConversion] soffice Warnings: ${stderr.trim()}`);
        }
        spreadsheetFile = path.join(tempDir, `original-${documentId}.xlsx`);
      }

      // Now run python script
      console.log(
        `[FormatConversion] Extracting text from ${spreadsheetFile} via pandas...`,
      );
      const { stdout: pyOut, stderr: pyErr } = await execFileAsync("python3", [
        path.join(process.cwd(), "processors", "python", "extract_xlsx.py"),
        spreadsheetFile,
      ]);

      if (pyErr && pyErr.trim() !== "") {
        console.warn(
          `[FormatConversion] Python Spreadsheet extractor Warnings: ${pyErr.trim()}`,
        );
      }

      return { extractedText: pyOut.trim() } satisfies FormatConversionResult;
    } else if (isXps(job.data.mimeType)) {
      console.log(`[ConvertToPDF] Converting XPS to PDF via mutool...`);
      const { stdout, stderr } = await execFileAsync("mutool", [
        "convert",
        "-o",
        outputFile,
        inputFile,
      ]);
      console.log(`[ConvertToPDF] mutool Result: ${stdout.trim()}`);
      if (stderr && stderr.trim() !== "") {
        console.warn(`[ConvertToPDF] mutool Warnings: ${stderr.trim()}`);
      }
    } else if (isEmail(job.data.mimeType)) {
      console.log(`[ConvertToPDF] Converting Email to HTML...`);
      const htmlFile = path.join(tempDir, `email-${documentId}.html`);
      const { stdout: pyOut, stderr: pyErr } = await execFileAsync("python3", [
        path.join(process.cwd(), "processors", "python", "convert_email.py"),
        inputFile,
        htmlFile,
      ]);
      if (pyErr && pyErr.trim() !== "") {
        console.warn(
          `[ConvertToPDF] Python Email extractor Warnings: ${pyErr.trim()}`,
        );
      }

      console.log(`[ConvertToPDF] Converting HTML to PDF via libreoffice...`);
      const { stdout, stderr } = await execFileAsync("soffice", [
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        tempDir,
        htmlFile,
      ]);
      console.log(`[ConvertToPDF] soffice Result: ${stdout.trim()}`);
      if (stderr && stderr.trim() !== "") {
        console.warn(`[ConvertToPDF] soffice Warnings: ${stderr.trim()}`);
      }
      finalPdfPath = path.join(tempDir, `email-${documentId}.pdf`);
    } else {
      console.log(`[ConvertToPDF] Converting to PDF via libreoffice...`);
      // soffice command to convert to pdf
      const { stdout, stderr } = await execFileAsync("soffice", [
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        tempDir,
        inputFile,
      ]);

      console.log(`[ConvertToPDF] Convert complete. Result: ${stdout.trim()}`);
      if (stderr && stderr.trim() !== "") {
        console.warn(
          `[ConvertToPDF] Warnings/Errors from libreoffice: ${stderr.trim()}`,
        );
      }
    }

    console.log(
      `[FormatConversion] Uploading converted PDF for ${documentId}...`,
    );
    const pdfBuffer = await fs.readFile(finalPdfPath);
    const { storage_path } = await uploadFile(
      documentId,
      "converted_pdf",
      pdfBuffer,
      "application/pdf",
    );

    return { convertedPdfPath: storage_path } satisfies FormatConversionResult;
  } finally {
    console.log(
      `[FormatConversion] Cleaning up temp files for ${documentId}...`,
    );
    await fs.rm(tempDir, { recursive: true, force: true }).catch((err) => {
      console.error(
        `[FormatConversion] Failed to clean up temp dir ${tempDir}:`,
        err.message,
      );
    });
  }
};

export const formatConversionWorker = new Worker<
  SubtaskInput,
  FormatConversionResult
>("format-conversion", processor, {
  connection,
  concurrency: 5,
});

formatConversionWorker.on("completed", (job) => {
  console.log(`[FormatConversion] Job ${job.id} completed`);
});

formatConversionWorker.on("failed", (job, error) => {
  console.error(`[FormatConversion] Job ${job?.id} failed:`, error.message);
});

export default formatConversionWorker;
