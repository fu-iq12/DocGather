/**
 * Subtask processing unit that extracts raw text streams synchronously.
 * Caps file payloads to prevent token explosions in subsequent downstream NLP steps.
 *
 * @see architecture/processing-workers.md - "Format Handling"
 */
import { Job, Worker } from "bullmq";
import { type SubtaskInput, type TxtExtractResult } from "../types.js";
import { downloadFile } from "../supabase.js";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { connection } from "../queues.js";

const MAX_TXT_LENGTH = 50_000; // Cap at 50k chars to avoid LLM token explosions

const processor = async (job: Job<SubtaskInput, TxtExtractResult>) => {
  const { documentId, mimeType } = job.data;

  // Create a temporary directory for processing this document
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `txt-${documentId}-`),
  );
  const inputFile = path.join(tempDir, `original-${documentId}.txt`);

  try {
    console.log(`[TxtSimpleExtract] Downloading original for ${documentId}...`);
    const buffer = await downloadFile(documentId, "original");

    // We expect text/plain, text/markdown, or text/csv. These are text-based.
    // Try to decode as UTF-8.
    let text = "";
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch (decodeErr) {
      console.warn(
        `[TxtSimpleExtract] UTF-8 decode failed for ${documentId}, falling back to non-fatal decode.`,
      );
      text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    }

    if (text.length > MAX_TXT_LENGTH) {
      console.warn(
        `[TxtSimpleExtract] Truncating text for ${documentId} from ${text.length} to ${MAX_TXT_LENGTH} characters.`,
      );
      text = text.substring(0, MAX_TXT_LENGTH) + "\n\n...[TRUNCATED]";
    }

    console.log(
      `[TxtSimpleExtract] Extracted ${text.length} characters of text for ${documentId}.`,
    );

    return {
      text,
      success: true,
    } satisfies TxtExtractResult;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(
      `[TxtSimpleExtract] Extraction failed for ${documentId}:`,
      errorMsg,
    );
    throw error;
  } finally {
    // Clean up temporary files
    await fs.rm(tempDir, { recursive: true, force: true }).catch((err) => {
      console.error(
        `[TxtSimpleExtract] Failed to clean up temp dir ${tempDir}:`,
        err.message,
      );
    });
  }
};

export const txtSimpleExtractWorker = new Worker<
  SubtaskInput,
  TxtExtractResult
>("txt-simple-extract", processor, {
  connection,
  concurrency: 5,
});

txtSimpleExtractWorker.on("completed", (job) => {
  console.log(`[TxtSimpleExtract] Job ${job.id} completed`);
});

txtSimpleExtractWorker.on("failed", (job, error) => {
  console.error(`[TxtSimpleExtract] Job ${job?.id} failed:`, error.message);
});

export default txtSimpleExtractWorker;
