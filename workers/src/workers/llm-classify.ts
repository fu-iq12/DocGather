/**
 * Subtask processing unit executing the primary text-based classification heuristic.
 * Employs a text-optimized LLM (e.g., Qwen) against extracted document payloads to determine structure taxonomy.
 *
 * @see architecture/processing-workers.md - "Phase 11: LLM Classification"
 */

import { Worker, Job } from "bullmq";
import { connection } from "../queues.js";
import { startObservation, propagateAttributes } from "@langfuse/tracing";
import { LangfuseClient } from "@langfuse/client";
import { LLMClient, parseResponse } from "../llm/index.js";
import type { SubtaskInput, LlmClassificationResult } from "../types.js";
import { trackLlmUsage } from "../llm/billing.js";
import { llmClassificationSchema } from "../llm/schemas/classify.js";
import { zodToTs } from "../llm/schemas/utils.js";

// Initialize the Langfuse client
const langfuse = new LangfuseClient();

/**
 * LLM Classify job processor
 */
export async function processLlmClassifyJob(
  job: Job<SubtaskInput>,
): Promise<LlmClassificationResult | null> {
  const { documentId, ownerId, jobTime } = job.data;
  let span: any;
  return await propagateAttributes(
    {
      traceName: "llm-classify",
      sessionId: `${jobTime}-${documentId}-orchestrator`,
      userId: ownerId,
      tags: ["worker", "llm-classify"],
    },
    async () => {
      span = startObservation("llm-classify");
      try {
        const result = await _processLlmClassifyJob(job, span);
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

async function _processLlmClassifyJob(
  job: Job<SubtaskInput>,
  trace: any,
): Promise<LlmClassificationResult | null> {
  const { documentId, extractedText } = job.data;

  try {
    if (!extractedText || extractedText.trim().length === 0) {
      console.log(
        `[LlmClassify] No extracted text for document ${documentId}, skipping`,
      );
      trace.update({ output: { skipped: true, reason: "no_text" } });
      return null;
    }

    console.log(
      `[LlmClassify] Classifying document ${documentId} (${extractedText.length} chars)`,
    );

    const client = new LLMClient();

    const langfusePrompt = await langfuse.prompt.get("classify");
    const systemPrompt = langfusePrompt.compile({
      LlmClassificationResponse: zodToTs(
        llmClassificationSchema,
        "LlmClassificationResponse",
      ),
    });

    const userPrompt = `Original Filename: ${job.data.originalFilename || "unknown"}\n\nDocument Text:\n${extractedText}`;

    const chatOptions = {
      responseFormat: { type: "json_object" as const },
      cachePrefix: job.queueName,
      temperature: 0,
      parentTrace: trace,
      langfusePrompt,
    };

    // Parse and type-validate against Zod schemas, with retry backoffs
    const MAX_PARSE_ATTEMPTS = 3;

    let response = await client.chat(systemPrompt, userPrompt, chatOptions);

    for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt++) {
      try {
        const result = parseResponse(
          response.content,
          userPrompt,
          llmClassificationSchema,
          trace,
        );

        await trackLlmUsage(documentId, "text", response);

        const output = {
          documentType: result.documentType || "other.unclassified",
          extractionConfidence: result.extractionConfidence || 0,
          language: result.language || "unknown",
          explanation: result.explanation,
          documentTitle: result.documentTitle,
          documentSummary: result.documentSummary,
        };

        trace.update({ output });
        return output;
      } catch (parseError) {
        if (attempt < MAX_PARSE_ATTEMPTS) {
          console.warn(
            `[LlmClassify] Parse/validation attempt ${attempt}/${MAX_PARSE_ATTEMPTS} failed for document ${documentId}` +
              (response.cached ? " (cached response)" : "") +
              `, retrying LLM call...`,
            parseError instanceof Error ? parseError.message : parseError,
          );

          // Retry the LLM call (skip cache to force a fresh request)
          response = await client.chat(systemPrompt, userPrompt, {
            ...chatOptions,
            skipCache: true,
          });
        } else {
          // Final attempt failed — return safe fallback
          console.error(
            `[LlmClassify] All ${MAX_PARSE_ATTEMPTS} parse attempts failed for document ${documentId}:`,
            parseError instanceof Error ? parseError.message : parseError,
          );
          const output = {
            documentType: "other.unclassified",
            extractionConfidence: 0,
            language: "unknown",
            explanation: "Validation failed",
          } as LlmClassificationResult;

          trace.update({
            output,
            metadata: { parseError: String(parseError) },
            tags: ["worker", "llm-classify", "error"],
          });
          return output;
        }
      }
    }

    // Unreachable, but TypeScript needs it
    return null;
  } catch (err) {
    throw err;
  }
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
