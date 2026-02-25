/**
 * LLM Provider Types
 *
 * Abstractions for vision LLM providers (OVHcloud, Ollama).
 */

/**
 * Message content for vision requests
 */
export interface VisionContent {
  type: "text" | "image_url";
  text?: string;
  image_url?: {
    url: string; // base64 data URL or HTTP URL
  };
}

/**
 * Chat message format (OpenAI-compatible)
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | VisionContent[];
}

/**
 * Chat request options
 */
export interface ChatRequestOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Skip cache lookup/write for this request */
  skipCache?: boolean;
  /** Cache folder prefix (e.g. "vision", "classify") */
  cachePrefix?: string;
  /** JSON schema response format for structured outputs */
  responseFormat?: {
    type: "json_schema" | "json_object";
    json_schema?: {
      name: string;
      strict?: boolean;
      schema: Record<string, unknown> | unknown;
    };
  };
}

/**
 * Chat response
 */
export interface ChatResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    pages?: number;
  };
  cached?: boolean;
}

/**
 * LLM Provider interface
 */
export interface LLMProvider {
  name: string;

  vision(
    systemPrompt: string,
    imageBuffer: ArrayBuffer,
    imageMimeType: string,
    options?: ChatRequestOptions,
  ): Promise<ChatResponse>;

  text(
    systemPrompt: string,
    userPrompt: string,
    options?: ChatRequestOptions,
  ): Promise<ChatResponse>;
}

/**
 * Provider configuration
 */
/**
 * specific provider configuration
 */
export interface ModelConfig {
  provider: "ovhcloud" | "mistral" | "ollama" | "mistral-ocr";
  endpoint: string;
  model: string;
  numCtx: number;
}

/**
 * Global LLM configuration
 */
export interface LLMConfig {
  cache: {
    enabled: boolean;
    dir: string;
  };
  vision: ModelConfig;
  ocr: ModelConfig;
  text: ModelConfig;
}

/**
 * Get default configuration from environment
 */
export function getDefaultConfig(): LLMConfig {
  const cacheEnabled = process.env.LLM_CACHE_ENABLED === "true";
  const cacheDir = process.env.LLM_CACHE_DIR || "/app/cache";
  const defaultNumCtx = parseInt(process.env.LLM_NUM_CTX || "8192", 10);

  // OCR Config (Specialized OCR models like Mistral OCR)
  const ocrProvider = (process.env.LLM_OCR_PROVIDER || "ovhcloud") as
    | "ovhcloud"
    | "mistral"
    | "ollama"
    | "mistral-ocr";
  const ocrModel =
    process.env.LLM_OCR_MODEL ||
    (ocrProvider === "mistral-ocr"
      ? "mistral-ocr-latest"
      : ocrProvider === "ollama"
        ? "mistral-small3.2"
        : ocrProvider === "mistral"
          ? "mistral-small-latest"
          : "Mistral-Small-3.2-24B-Instruct-2506");
  const ocrEndpoint =
    process.env.LLM_OCR_ENDPOINT ||
    (ocrProvider === "mistral-ocr"
      ? "https://api.mistral.ai/v1/ocr"
      : ocrProvider === "ollama"
        ? "http://host.docker.internal:11434/v1/chat/completions"
        : ocrProvider === "mistral"
          ? "https://api.mistral.ai/v1/chat/completions"
          : "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions");

  // Text Config
  const textProvider = (process.env.LLM_TEXT_PROVIDER || "ovhcloud") as
    | "ovhcloud"
    | "mistral"
    | "ollama";
  const textModel =
    process.env.LLM_TEXT_MODEL ||
    (textProvider === "ollama"
      ? "mistral-small3.2"
      : textProvider === "mistral"
        ? "mistral-small-latest"
        : "Mistral-Small-3.2-24B-Instruct-2506");
  const textEndpoint =
    process.env.LLM_TEXT_ENDPOINT ||
    (textProvider === "ollama"
      ? "http://host.docker.internal:11434/v1/chat/completions"
      : textProvider === "mistral"
        ? "https://api.mistral.ai/v1/chat/completions"
        : "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions");

  // Vision Config (VLMs for document normalization/explanation)
  const visionProvider = (process.env.LLM_VISION_PROVIDER || "ovhcloud") as
    | "ovhcloud"
    | "mistral"
    | "ollama";
  const visionModel =
    process.env.LLM_VISION_MODEL ||
    (visionProvider === "ollama"
      ? "mistral-small3.2"
      : visionProvider === "mistral"
        ? "mistral-small-latest"
        : "Mistral-Small-3.2-24B-Instruct-2506");
  const visionEndpoint =
    process.env.LLM_VISION_ENDPOINT ||
    (visionProvider === "ollama"
      ? "http://host.docker.internal:11434/v1/chat/completions"
      : visionProvider === "mistral"
        ? "https://api.mistral.ai/v1/chat/completions"
        : "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions");

  return {
    cache: {
      enabled: cacheEnabled,
      dir: cacheDir,
    },
    vision: {
      provider: visionProvider,
      endpoint: visionEndpoint,
      model: visionModel,
      numCtx: defaultNumCtx,
    },
    ocr: {
      provider: ocrProvider,
      endpoint: ocrEndpoint,
      model: ocrModel,
      numCtx: defaultNumCtx,
    },
    text: {
      provider: textProvider,
      endpoint: textEndpoint,
      model: textModel,
      numCtx: defaultNumCtx,
    },
  };
}
