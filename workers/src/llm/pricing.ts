/**
 * LLM Pricing Configuration
 * Prices are in USD.
 * For text/vision models: price per 1,000,000 tokens.
 * For mistral-ocr: price per 1,000 pages.
 */

export const PRICING = {
  ovhcloud: {
    "Mistral-Small-3.2-24B-Instruct-2506": {
      prompt: 0.09,
      completion: 0.28,
    },
    "Qwen2.5-VL-72B-Instruct": {
      prompt: 0.91,
      completion: 0.91,
    },
  },
  ollama: {
    // Local models are free
    "mistral-small3.2": { prompt: 0, completion: 0 },
    "qwen2.5-vl:3b": { prompt: 0, completion: 0 },
  },
  mistral: {
    "mistral-small-latest": { prompt: 0.1, completion: 0.3 },
    "mistral-medium-latest": { prompt: 0.4, completion: 2.0 },
    "mistral-large-latest": { prompt: 0.5, completion: 1.5 },
  },
  "mistral-ocr": {
    "mistral-ocr-latest": { pages: 2.0 }, // $1 per 1,000 pages
  },
} as const;

export function getCost(
  provider: string,
  model: string,
  usage: { promptTokens?: number; completionTokens?: number; pages?: number },
): number {
  let cost = 0;

  if (provider === "ollama") return 0;

  const providerPricing = (PRICING as any)[provider];
  if (!providerPricing) return 0;

  const modelPricing = providerPricing[model];
  if (!modelPricing) return 0;

  if (usage.promptTokens && modelPricing.prompt) {
    cost += (usage.promptTokens / 1_000_000) * modelPricing.prompt;
  }
  if (usage.completionTokens && modelPricing.completion) {
    cost += (usage.completionTokens / 1_000_000) * modelPricing.completion;
  }
  if (usage.pages && modelPricing.pages) {
    cost += (usage.pages / 1000) * modelPricing.pages;
  }

  return cost;
}
