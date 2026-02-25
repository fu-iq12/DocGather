/**
 * LLM Client
 *
 * Unified interface for LLM providers with optional caching.
 * Supports separate models for Vision and Text tasks.
 */

import type {
  LLMProvider,
  ChatMessage,
  ChatRequestOptions,
  ChatResponse,
  LLMConfig,
  ModelConfig,
} from "./types.js";
import { getDefaultConfig } from "./types.js";
import { GenericProvider } from "./providers/generic.js";
import { MistralProvider } from "./providers/mistral.js";
import { OllamaProvider } from "./providers/ollama.js";
import { LLMCache } from "./cache.js";
import { MistralOcrProvider } from "./providers/mistral-ocr.js";

/**
 * Create LLM provider based on configuration
 */
function createProvider(modelConfig: ModelConfig): LLMProvider {
  switch (modelConfig.provider) {
    case "mistral-ocr":
      if (!process.env.MISTRAL_API_KEY) {
        throw new Error("MISTRAL_API_KEY is required for Mistral provider");
      }
      return new MistralOcrProvider(
        modelConfig.endpoint,
        modelConfig.model,
        process.env.MISTRAL_API_KEY,
      );
    case "ollama":
      return new OllamaProvider(
        modelConfig.endpoint,
        modelConfig.model,
        modelConfig.numCtx,
      );
    case "mistral":
      if (!process.env.MISTRAL_API_KEY) {
        throw new Error("MISTRAL_API_KEY is required for Mistral provider");
      }
      return new MistralProvider(
        modelConfig.endpoint,
        modelConfig.model,
        process.env.MISTRAL_API_KEY,
      );
    case "ovhcloud":
    default:
      if (!process.env.OVH_AI_API_KEY) {
        throw new Error("OVH_AI_API_KEY is required for OVHcloud provider");
      }
      return new GenericProvider(
        modelConfig.endpoint,
        modelConfig.model,
        process.env.OVH_AI_API_KEY,
      );
  }
}

/**
 * LLM Client with caching support
 */
export class LLMClient {
  private visionProvider: LLMProvider;
  private ocrProvider: LLMProvider;
  private textProvider: LLMProvider;
  private cache: LLMCache | null;
  private config: LLMConfig;

  constructor(config?: Partial<LLMConfig>) {
    this.config = { ...getDefaultConfig(), ...config };

    this.visionProvider = createProvider(this.config.vision);
    this.ocrProvider = createProvider(this.config.ocr);
    this.textProvider = createProvider(this.config.text);

    this.cache = this.config.cache.enabled
      ? new LLMCache(this.config.cache.dir)
      : null;
  }

  /**
   * Get the current vision model
   */
  get visionModel(): string {
    return this.config.vision.model;
  }

  /**
   * Get the current text model
   */
  get textModel(): string {
    return this.config.text.model;
  }

  /**
   * Send a vision request (uses Vision model)
   */
  async vision(
    systemPrompt: string,
    imageBuffer: ArrayBuffer,
    imageMimeType: string,
    options?: ChatRequestOptions,
  ): Promise<ChatResponse> {
    const model = options?.model || this.config.vision.model;
    const prefix = options?.cachePrefix || "vision";

    // Check cache first
    if (this.cache && !options?.skipCache) {
      const cached = await this.cache.get(
        { systemPrompt, imageBuffer },
        model,
        prefix,
      );
      if (cached) {
        console.log(`[LLMClient] Cache hit for model ${model} (${prefix})`);
        return cached;
      }
    }

    // Call provider
    const response = await this.visionProvider.vision(
      systemPrompt,
      imageBuffer,
      imageMimeType,
      {
        ...options,
        model,
      },
    );

    // Cache response
    if (this.cache && !options?.skipCache) {
      await this.cache.set(
        { systemPrompt, imageBuffer },
        model,
        response,
        prefix,
      );
    }

    return response;
  }

  /**
   * Send an OCR request (uses OCR model)
   */
  async ocr(
    systemPrompt: string,
    imageBuffer: ArrayBuffer,
    imageMimeType: string,
    options?: ChatRequestOptions,
  ): Promise<ChatResponse> {
    const model = options?.model || this.config.ocr.model;
    const prefix = options?.cachePrefix || "ocr";

    // Check cache first
    if (this.cache && !options?.skipCache) {
      const cached = await this.cache.get(
        { systemPrompt, imageBuffer },
        model,
        prefix,
      );
      if (cached) {
        console.log(`[LLMClient] Cache hit for model ${model} (${prefix})`);
        return cached;
      }
    }

    // Call provider
    const response = await this.ocrProvider.vision(
      systemPrompt,
      imageBuffer,
      imageMimeType,
      {
        ...options,
        model,
      },
    );

    // Cache response
    if (this.cache && !options?.skipCache) {
      await this.cache.set(
        { systemPrompt, imageBuffer },
        model,
        response,
        prefix,
      );
    }

    return response;
  }

  /**
   * Send a text/classify request (uses Text model)
   */
  async chat(
    systemPrompt: string,
    userPrompt: string,
    options?: ChatRequestOptions,
  ): Promise<ChatResponse> {
    const model = options?.model || this.config.text.model;
    const prefix = options?.cachePrefix || "chat";

    // Check cache first
    if (this.cache && !options?.skipCache) {
      const cached = await this.cache.get(
        { systemPrompt, userPrompt },
        model,
        prefix,
      );
      if (cached) {
        console.log(`[LLMClient] Cache hit for model ${model} (${prefix})`);
        return cached;
      }
    }

    // Call provider
    const response = await this.textProvider.text(systemPrompt, userPrompt, {
      ...options,
      model,
    });

    // Cache response
    if (this.cache && !options?.skipCache) {
      await this.cache.set(
        { systemPrompt, userPrompt },
        model,
        response,
        prefix,
      );
    }

    return response;
  }
}

// Re-export types
export type { ChatMessage, ChatResponse, ChatRequestOptions } from "./types.js";
