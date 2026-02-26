/**
 * Unified interface orchestrating all external LLM interactions.
 * Connects the 'pdf-simple-extract', 'llm-ocr', 'llm-classify', and 'llm-normalize'
 * steps to their configured providers (OVHcloud, Mistral, Ollama) while managing caching transparently.
 *
 * @see architecture/details/document-types-and-processing.md - "Simplified PDF Processing Flow"
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
 * Factory function instantiating the appropriate provider client (Generic, Mistral, Ollama, etc.)
 * based on the environment configuration and injecting the necessary API keys.
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
 * Orchestrator client exposing high-level methods for vision, targeted OCR, and structured text tasks.
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

  get visionModel(): string {
    return this.config.vision.model;
  }

  get textModel(): string {
    return this.config.text.model;
  }

  /**
   * Executes a Vision model request for generic image analysis or fallback extraction.
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
   * Executes a specialized OCR model request (e.g., mistral-ocr) optimized for dense document extraction.
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
   * Executes a standard text-based LLM request for classification and normalization tasks.
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

  /**
   * Uploads a file to the provider (if supported) for subsequent OCR/Vision calls.
   */
  async upload(
    documentId: string,
    imageBuffer: ArrayBuffer,
    imageMimeType: string,
    target: "ocr" | "vision",
  ): Promise<string | undefined> {
    const provider = target === "ocr" ? this.ocrProvider : this.visionProvider;
    if (provider.upload) {
      return provider.upload(documentId, imageBuffer, imageMimeType, "ocr");
    }
    return undefined;
  }

  /**
   * Deletes a previously uploaded file from the provider.
   */
  async delete(fileId: string): Promise<void> {
    // Only need to delete once if both use the same provider/account,
    // but try the first one that supports it.
    if (this.ocrProvider.delete) {
      await this.ocrProvider.delete(fileId);
    } else if (this.visionProvider.delete) {
      await this.visionProvider.delete(fileId);
    }
  }
}

// Re-export types
export type { ChatMessage, ChatResponse, ChatRequestOptions } from "./types.js";
