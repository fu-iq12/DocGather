/**
 * Utility to track and persist LLM billing
 */

import { supabase } from "../supabase.js";
import { getCost } from "./pricing.js";
import { getDefaultConfig } from "./types.js";
import type { ChatResponse } from "./types.js";

export async function trackLlmUsage(
  documentId: string,
  task: "text" | "vision" | "ocr",
  response: ChatResponse,
): Promise<void> {
  // Skip if it was a cache hit
  if (response.cached) {
    console.log(
      `[Billing] Skipping billing for cached response (document ${documentId})`,
    );
    return;
  }

  if (!response.usage) {
    return;
  }

  const config = getDefaultConfig();
  const provider = config[task].provider;
  const model = response.model || config[task].model;

  const { promptTokens = 0, completionTokens = 0, pages = 0 } = response.usage;
  const cost = getCost(provider, model, {
    promptTokens,
    completionTokens,
    pages,
  });

  console.log(
    `[Billing] Document ${documentId}: ${provider}/${model} used ${promptTokens} prompt, ${completionTokens} completion, ${pages} pages. Cost: $${cost.toFixed(6)}`,
  );

  const { error } = await supabase.rpc("worker_increment_llm_billing", {
    p_document_id: documentId,
    p_prompt_tokens: promptTokens,
    p_completion_tokens: completionTokens,
    p_pages: pages,
    p_cost: cost,
  });

  if (error) {
    console.error(
      `[Billing] Failed to update LLM billing for document ${documentId}:`,
      error.message,
    );
  }
}
