/**
 * Subtask processing unit that drives the dense Vision OCR pipeline.
 * Extracts flat textual representations from complex layouts alongside structural layout markers and languages.
 *
 * @see architecture/processing-workers.md - "Phase 10: LLM OCR"
 */

import { Worker, Job } from "bullmq";
import { connection } from "../queues.js";
import { downloadFile } from "../supabase.js";
import { startObservation, propagateAttributes } from "@langfuse/tracing";
import { LangfuseClient } from "@langfuse/client";
import { LLMClient, parseResponse } from "../llm/index.js";
import type { SubtaskInput, LlmOcrResult } from "../types.js";
import { trackLlmUsage } from "../llm/billing.js";
import { llmOcrSchema } from "../llm/schemas/ocr.js";
import { zodToTs } from "../llm/schemas/utils.js";

// Initialize the Langfuse client
const langfuse = new LangfuseClient();

/**
 * Convert extractedText to flat string (for compatibility)
 */
function flattenExtractedText(extracted: {
  contentType: "structured" | "raw";
  content: string | Record<string, unknown>;
}): string {
  if (typeof extracted.content === "string") {
    return extracted.content;
  }
  // Convert structured data to readable text
  return JSON.stringify(extracted.content, null, 2);
}

/**
 * LlmOcr job processor
 */
export async function processLlmOcrJob(
  job: Job<SubtaskInput>,
): Promise<LlmOcrResult> {
  const { documentId, ownerId, jobTime } = job.data;
  let span: any;
  return await propagateAttributes(
    {
      traceName: "llm-ocr",
      sessionId: `${jobTime}-${documentId}-orchestrator`,
      userId: ownerId,
      tags: ["worker", "llm-ocr"],
    },
    async () => {
      span = startObservation("llm-ocr");
      try {
        const result = await _processLlmOcrJob(job, span);
        span.end();
        return result;
      } catch (err) {
        span
          .update({
            level: "ERROR",
            statusMessage: String(err),
            metadata: { error: String(err) },
          })
          .end();
        throw err;
      }
    },
  );
}

async function _processLlmOcrJob(
  job: Job<SubtaskInput>,
  trace: any,
): Promise<LlmOcrResult> {
  const { documentId, scaledImagePaths } = job.data;

  try {
    if (!scaledImagePaths || scaledImagePaths.length === 0) {
      console.log(
        `[LlmOcr] No scaled images for document ${documentId}, skipping`,
      );
      return {
        rawText: "",
        structuredData: null,
        documentDescription: "No images to process",
        language: "unknown",
        pageCount: 0,
        extractedBy: "none",
        model: "none",
        cached: false,
      };
    }

    console.log(
      `[LlmOcr] Processing ${scaledImagePaths.length} image(s) for document ${documentId}`,
    );

    // Download scaled image (decrypted via edge function)
    const buffer = await downloadFile(documentId, "llm_optimized");

    // Create LLM client
    const client = new LLMClient();

    const langfusePrompt = await langfuse.prompt.get("ocr");
    const systemPrompt = langfusePrompt.compile({
      LlmOcrResponse: zodToTs(llmOcrSchema, "LlmOcrResponse"),
    });

    const visionOptions = {
      responseFormat: { type: "json_object" as const },
      cachePrefix: job.queueName,
      fileId: job.data.llmFileId,
      parentTrace: trace,
      langfusePrompt,
    };

    // Attempt to upload file for Mistral-backed providers to avoid base64 limits
    if (!visionOptions.fileId) {
      try {
        const uploadedFileId = await client.upload(
          documentId,
          buffer,
          "image/webp",
          "ocr",
        );
        if (uploadedFileId) {
          visionOptions.fileId = uploadedFileId;
          // Save back to job so later retries or downstream steps can reuse it
          await job.updateData({ ...job.data, llmFileId: uploadedFileId });
        }
      } catch (uploadError) {
        console.warn(
          `[LlmOcr] Failed to upload file to Mistral for ${documentId}, falling back to base64:`,
          uploadError,
        );
      }
    }

    let response = await client.ocr(
      systemPrompt,
      buffer,
      "image/webp",
      visionOptions,
    );

    // Parse + validate with retry (up to 3 attempts)
    const MAX_PARSE_ATTEMPTS = 3;
    let parsed: ReturnType<typeof llmOcrSchema.parse> = undefined!;
    for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt++) {
      try {
        parsed = parseResponse(
          response.content,
          systemPrompt,
          llmOcrSchema,
          trace,
        );
        await trackLlmUsage(documentId, "ocr", response);
        break; // success
      } catch (parseError) {
        if (attempt === MAX_PARSE_ATTEMPTS) throw parseError;
        console.warn(
          `[LlmOcr] Parse/validation attempt ${attempt}/${MAX_PARSE_ATTEMPTS} failed for document ${documentId}` +
            (response.cached ? " (cached response)" : "") +
            `, retrying LLM call...`,
          parseError instanceof Error ? parseError.message : parseError,
        );

        // Retry the LLM call (skip cache to force a fresh request)
        response = await client.ocr(systemPrompt, buffer, "image/webp", {
          ...visionOptions,
          skipCache: true,
        });
      }
    }

    // Determine if we got structured or flat text
    const isStructured = parsed.extractedText.contentType === "structured";
    const rawText = flattenExtractedText(parsed.extractedText);
    const charCount = rawText.length;

    // console.log(
    //   `[LlmOcr] Document ${documentId}: ${parsed.documentDescription} (${parsed.language})` +
    //     ` - ${charCount} chars` +
    //     (isStructured ? " [structured]" : "") +
    //     (response.cached ? " (cached)" : "") +
    //     (response.usage ? ` (${response.usage.totalTokens} tokens)` : ""),
    // );

    const output = {
      rawText,
      structuredData: isStructured
        ? (parsed.extractedText.content as Record<string, unknown>)
        : null,
      documentDescription: parsed.documentDescription,
      language: parsed.language,
      pageCount: scaledImagePaths.length,
      extractedBy: "ocr",
      model: response.model,
      cached: response.cached || false,
    } as LlmOcrResult;

    trace.update({ output });
    return output;
  } catch (err) {
    throw err;
  }
}

/**
 * LlmOcr worker
 */
export const llmOcrWorker = new Worker<SubtaskInput, LlmOcrResult>(
  "llm-ocr",
  async (job) => {
    return processLlmOcrJob(job);
  },
  {
    connection,
    concurrency: 5, // external service, high concurrency possible
  },
);

llmOcrWorker.on("completed", (job) => {
  console.log(`[LlmOcr] Job ${job.id} completed`);
});

llmOcrWorker.on("failed", (job, error) => {
  console.error(`[LlmOcr] Job ${job?.id} failed:`, error.message);
});
