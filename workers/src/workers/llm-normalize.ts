/**
 * Subtask processing unit responsible for mutating free-form document text into strongly-typed
 * structured JSON per the \`DOCUMENT_TYPES\` taxonomy constraints. Validates via Zod.
 *
 * @see architecture/processing-workers.md - "Phase 12: LLM Normalization"
 */

import { Worker, Job } from "bullmq";
import { connection } from "../queues.js";
import { downloadFile } from "../supabase.js";
import { LLMClient } from "../llm/index.js";
import type { SubtaskInput, LlmNormalizationResult } from "../types.js";
import { trackLlmUsage } from "../llm/billing.js";
import { DOCUMENT_TYPES } from "../llm/schemas/document-types/index.js";
import { getNormalizeSystemPrompt } from "../llm/prompts/normalize.js";

/**
 * Parse extraction response
 */
function parseResponse(content: string): Record<string, unknown> {
  const jsonMatch = content.match(/```(?:json|typescript)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : content.trim();

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.warn(
      "[DEBUG] LlmNormalize.parseResponse failed, jsonStr:",
      jsonStr,
    );
    throw new Error(
      `Failed to parse LLM response as JSON: ${e instanceof Error ? e.message : e}`,
    );
  }
}

/**
 * LLM Normalize job processor
 */
export async function processLlmNormalizeJob(
  job: Job<SubtaskInput>,
): Promise<LlmNormalizationResult | null> {
  const { documentId, extractedText, classification } = job.data;

  if (!extractedText || !classification) {
    console.log(
      `[LlmNormalize] Missing text or classification for ${documentId}, skipping`,
    );
    return null;
  }

  const { documentType } = classification;
  console.log(`[LlmNormalize] Normalizing ${documentId} as ${documentType}`);

  const docDef =
    DOCUMENT_TYPES.find((d) => d.id === documentType) ||
    DOCUMENT_TYPES.find((d) => d.id === "other.unclassified")!;

  const schema = docDef.schema;

  const client = new LLMClient();

  const systemPrompt = getNormalizeSystemPrompt(docDef);
  const promptText = `Original Filename: ${job.data.originalFilename || "unknown"}\n\nDocument Text:\n${extractedText}`;

  const chatOptions = {
    responseFormat: { type: "json_object" as const },
    cachePrefix: `${job.queueName}/${documentType}`,
    temperature: 0,
    fileId: job.data.llmFileId,
  };

  const useVisionFallback =
    classification.extractionConfidence < 0.8 &&
    job.data.extractionMethod === "vision";

  // Parse + validate with retry (up to 3 attempts)
  const MAX_PARSE_ATTEMPTS = 3;
  let response;

  if (useVisionFallback) {
    console.log(
      `[LlmNormalize] Extraction confidence < 0.8 and method is vision. Using multimodal normalization fallback.`,
    );
    const buffer = await downloadFile(documentId, "llm_optimized");

    // Attempt to upload file for Mistral-backed providers to avoid base64 limits
    if (!chatOptions.fileId) {
      try {
        const uploadedFileId = await client.upload(
          documentId,
          buffer,
          "image/webp",
          "vision",
        );
        if (uploadedFileId) {
          chatOptions.fileId = uploadedFileId;
          // Save back to job
          await job.updateData({ ...job.data, llmFileId: uploadedFileId });
        }
      } catch (uploadError) {
        console.warn(
          `[LlmNormalize] Failed to upload file to Mistral for ${documentId}, falling back to base64:`,
          uploadError,
        );
      }
    }

    response = await client.vision(
      systemPrompt,
      buffer,
      "image/webp",
      chatOptions,
    );
  } else {
    response = await client.chat(systemPrompt, promptText, chatOptions);
  }

  for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt++) {
    try {
      const rawData = parseResponse(response.content);

      // STRICT VALIDATION
      const validatedData = schema.parse(rawData) as Record<string, unknown>;

      await trackLlmUsage(
        documentId,
        useVisionFallback ? "vision" : "text",
        response,
      );

      return {
        template: documentType,
        fields: validatedData,
      };
    } catch (parseError) {
      if (attempt < MAX_PARSE_ATTEMPTS) {
        console.warn(
          `[LlmNormalize] Parse/validation attempt ${attempt}/${MAX_PARSE_ATTEMPTS} failed for ${documentId}` +
            (response.cached ? " (cached response)" : "") +
            `, retrying LLM call...`,
          parseError instanceof Error ? parseError.message : parseError,
        );

        // Retry the LLM call (skip cache to force a fresh request)
        if (useVisionFallback) {
          const buffer = await downloadFile(documentId, "llm_optimized");
          response = await client.vision(systemPrompt, buffer, "image/webp", {
            ...chatOptions,
            skipCache: true,
          });
        } else {
          response = await client.chat(systemPrompt, promptText, {
            ...chatOptions,
            skipCache: true,
          });
        }
      } else {
        console.error(
          `[LlmNormalize] All ${MAX_PARSE_ATTEMPTS} parse attempts failed for ${documentId}:`,
          parseError instanceof Error ? parseError.message : parseError,
        );
        return null;
      }
    }
  }

  // Unreachable, but TypeScript needs it
  return null;
}

/**
 * LLM Normalize worker
 */
export const llmNormalizeWorker = new Worker<
  SubtaskInput,
  LlmNormalizationResult | null
>(
  "llm-normalize",
  async (job) => {
    return processLlmNormalizeJob(job);
  },
  {
    connection,
    concurrency: 5, // external service, high concurrency possible
  },
);

llmNormalizeWorker.on("completed", (job) => {
  console.log(`[LlmNormalize] Job ${job?.id} completed`);
});

llmNormalizeWorker.on("failed", (job, error) => {
  console.error(`[LlmNormalize] Job ${job?.id} failed:`, error.message);
});
