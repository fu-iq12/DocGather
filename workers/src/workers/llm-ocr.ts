/**
 * LlmOcr Worker (formerly Image Text Extraction)
 *
 * Uses LLM Vision to extract text from images and scanned PDFs.
 * Also identifies the document type for early classification hints.
 * Supports OVHcloud AI Endpoints and local Ollama for testing.
 */

import { Worker, Job } from "bullmq";
import { connection } from "../queues.js";
import { downloadFile } from "../supabase.js";
import { LLMClient } from "../llm/index.js";
import type { SubtaskInput, LlmOcrResult } from "../types.js";
import { trackLlmUsage } from "../llm/billing.js";
import { llmOcrSchema } from "../llm/schemas/ocr.js";
import { OCR_SYSTEM_PROMPT } from "../llm/prompts/ocr.js";

/**
 * Parse LLM response (handles JSON in markdown code blocks)
 */
function parseResponse(content: string): {
  documentDescription: string;
  language: string | string[];
  extractedText: {
    contentType: "structured" | "raw";
    content: string | Record<string, unknown>;
  };
} {
  // Try to extract JSON from markdown code block
  const jsonMatch = content.match(/```(?:json|typescript)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : content.trim();

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.warn("[DEBUG] LlmOcr.parseResponse failed, jsonStr:", jsonStr);
    throw new Error(
      `Failed to parse LLM response as JSON: ${e instanceof Error ? e.message : e}`,
    );
  }
}

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
async function processLlmOcrJob(job: Job<SubtaskInput>): Promise<LlmOcrResult> {
  const { documentId, scaledImagePaths } = job.data;

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

  const visionOptions = {
    responseFormat: { type: "json_object" as const },
    cachePrefix: job.queueName,
  };

  let response = await client.ocr(
    OCR_SYSTEM_PROMPT,
    buffer,
    "image/webp",
    visionOptions,
  );

  // Parse + validate with retry (up to 3 attempts)
  const MAX_PARSE_ATTEMPTS = 3;
  let parsed: ReturnType<typeof llmOcrSchema.parse> = undefined!;
  for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt++) {
    try {
      const rawParsed = parseResponse(response.content);
      parsed = llmOcrSchema.parse(rawParsed);
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
      response = await client.ocr(OCR_SYSTEM_PROMPT, buffer, "image/webp", {
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

  return {
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
  };
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

export { processLlmOcrJob, parseResponse };
