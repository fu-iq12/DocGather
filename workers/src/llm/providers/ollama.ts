/**
 * Ollama Provider
 *
 * Local LLM provider for development and testing.
 * Uses Ollama's OpenAI-compatible API.
 */

import type {
  ChatMessage,
  ChatRequestOptions,
  ChatResponse,
} from "../types.js";
import { GenericProvider } from "./generic.js";

export class OllamaProvider extends GenericProvider {
  name = "ollama";

  /** Mutex queue to prevent concurrent Ollama API calls */
  _chatQueue: Promise<void> = Promise.resolve();

  constructor(
    endpoint: string,
    defaultModel: string,
    protected defaultNumCtx: number,
  ) {
    super(endpoint, defaultModel, "");
  }

  protected _getRequestBody(
    messages: ChatMessage[],
    options?: ChatRequestOptions,
  ): Record<string, unknown> {
    const model = options?.model || this.defaultModel;

    const requestBody: Record<string, unknown> = {
      model,
      messages,
      temperature: options?.temperature ?? 0.1,
      max_tokens: options?.maxTokens ?? 4096,
      stream: false,
      keep_alive: "5m",
      // Ollama-specific: limit context window to save VRAM
      options: {
        num_ctx: this.defaultNumCtx,
      },
    };

    // Ollama supports structured outputs via "format" parameter with JSON schema
    // https://ollama.com/blog/structured-outputs
    // Ollama support for structured outputs
    if (options?.responseFormat) {
      if (
        options.responseFormat.type === "json_schema" &&
        options.responseFormat.json_schema
      ) {
        requestBody.format = options.responseFormat.json_schema.schema;
      } else if (options.responseFormat.type === "json_object") {
        requestBody.format = "json";
      }
    }

    return requestBody;
  }

  protected async _chat(
    messages: ChatMessage[],
    options?: ChatRequestOptions,
  ): Promise<ChatResponse> {
    // Serialize calls — wait for any in-flight request to finish before starting
    return new Promise<ChatResponse>((resolve, reject) => {
      this._chatQueue = this._chatQueue.then(async () => {
        try {
          resolve(await this._doChat(messages, options));
        } catch (err) {
          reject(err);
        }
      });
    });
  }
}
