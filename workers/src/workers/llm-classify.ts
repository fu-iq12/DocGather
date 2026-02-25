/**
 * LLM Classify Worker
 *
 * Classifies document based on extracted text.
 * Uses Text-optimized LLM (e.g. Qwen2.5-32B).
 *
 * Input:
 * - extractedText (convenience shorthand)
 *
 * Output:
 * - ClassificationResult (documentType, confidence, hints)
 */

import { Worker, Job } from "bullmq";
import { connection } from "../queues.js";
import { LLMClient } from "../llm/index.js";
import type { SubtaskInput, LlmClassificationResult } from "../types.js";
import { trackLlmUsage } from "../llm/billing.js";
import { llmClassificationSchema } from "../llm/schemas/classify.js";
import { CLASSIFY_SYSTEM_PROMPT } from "../llm/prompts/classify.js";

/**
 * Parse LLM response
 */
// Helpers to parse response
function parseResponse(content: string): any {
  const jsonMatch = content.match(/```(?:json|typescript)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : content.trim();
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.warn("[DEBUG] LlmClassify.parseResponse failed, jsonStr:", jsonStr);
    throw new Error(
      `Failed to parse LLM response as JSON: ${e instanceof Error ? e.message : e}`,
    );
  }
}

/**
 * LLM Classify job processor
 */
async function processLlmClassifyJob(
  job: Job<SubtaskInput>,
): Promise<LlmClassificationResult | null> {
  const { documentId, extractedText } = job.data;

  if (!extractedText || extractedText.trim().length === 0) {
    console.log(
      `[LlmClassify] No extracted text for document ${documentId}, skipping`,
    );
    return null;
  }

  console.log(
    `[LlmClassify] Classifying document ${documentId} (${extractedText.length} chars)`,
  );

  const client = new LLMClient();

  const chatOptions = {
    responseFormat: { type: "json_object" as const },
    cachePrefix: job.queueName,
    temperature: 0,
  };

  // Parse + validate with retry (up to 3 attempts)
  const MAX_PARSE_ATTEMPTS = 3;
  const promptText = `Original Filename: ${job.data.originalFilename || "unknown"}\n\nDocument Text:\n${extractedText}`;

  let response = await client.chat(
    CLASSIFY_SYSTEM_PROMPT,
    promptText,
    chatOptions,
  );

  for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt++) {
    try {
      const headers = parseResponse(response.content);

      // STRICT VALIDATION
      const result = llmClassificationSchema.parse(headers);

      await trackLlmUsage(documentId, "text", response);

      return {
        documentType: result.documentType || "other.unclassified",
        extractionConfidence: result.extractionConfidence || 0,
        language: result.language || "unknown",
        explanation: result.explanation,
        documentSummary: result.documentSummary,
      };
    } catch (parseError) {
      if (attempt < MAX_PARSE_ATTEMPTS) {
        console.warn(
          `[LlmClassify] Parse/validation attempt ${attempt}/${MAX_PARSE_ATTEMPTS} failed for document ${documentId}` +
            (response.cached ? " (cached response)" : "") +
            `, retrying LLM call...`,
          parseError instanceof Error ? parseError.message : parseError,
        );

        // Retry the LLM call (skip cache to force a fresh request)
        response = await client.chat(CLASSIFY_SYSTEM_PROMPT, promptText, {
          ...chatOptions,
          skipCache: true,
        });
      } else {
        // Final attempt failed — return safe fallback
        console.error(
          `[LlmClassify] All ${MAX_PARSE_ATTEMPTS} parse attempts failed for document ${documentId}:`,
          parseError instanceof Error ? parseError.message : parseError,
        );
        return {
          documentType: "other.unclassified",
          extractionConfidence: 0,
          language: "unknown",
          explanation: "Validation failed",
        };
      }
    }
  }

  // Unreachable, but TypeScript needs it
  return {
    documentType: "other.unclassified",
    extractionConfidence: 0,
    language: "unknown",
    explanation: "Validation failed",
  };
}

/**
 * LLM Classify worker
 */
export const llmClassifyWorker = new Worker<
  SubtaskInput,
  LlmClassificationResult | null
>(
  "llm-classify",
  async (job) => {
    return processLlmClassifyJob(job);
  },
  {
    connection,
    concurrency: 5, // external service, high concurrency possible
  },
);

llmClassifyWorker.on("completed", (job) => {
  console.log(`[LlmClassify] Job ${job?.id} completed`);
});

llmClassifyWorker.on("failed", (job, error) => {
  console.error(`[LlmClassify] Job ${job?.id} failed:`, error.message);
});

export { processLlmClassifyJob };
