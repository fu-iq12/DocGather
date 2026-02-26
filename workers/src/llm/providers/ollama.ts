/**
 * Local development provider targeting an Ollama instance.
 * Adapts generic payloads with Ollama-specific options (e.g., num_ctx) to manage local VRAM constraints.
 */

import type {
  ChatMessage,
  ChatRequestOptions,
  ChatResponse,
} from "../types.js";
import { GenericProvider } from "./generic.js";

export class OllamaProvider extends GenericProvider {
  name = "ollama";

  /** Serializes API calls via a mutex to prevent crashing local instances with concurrent requests */
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
      // Constrain context size relative to VRAM allocation (numCtx)
      options: {
        num_ctx: this.defaultNumCtx,
      },
    };

    // Map OpenAI structured outputs to Ollama's native 'format' schema
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
    // Queue execution to prevent OOM on local Ollama server
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
