/**
 * Thin wrapper over GenericProvider specifically for Mistral's API endpoints.
 * Injects a global rate-limiter interceptor across all requests to adhere to tight concurrent limits.
 */

import type {
  ChatMessage,
  ChatRequestOptions,
  ChatResponse,
} from "../types.js";
import { GenericProvider } from "./generic.js";
import { MistralRateLimiter } from "./mistral-rate-limiter.js";

export class MistralProvider extends GenericProvider {
  name = "mistral";

  protected async _chat(
    messages: ChatMessage[],
    options?: ChatRequestOptions,
  ): Promise<ChatResponse> {
    const body = JSON.stringify(this._getRequestBody(messages, options));
    return MistralRateLimiter.getInstance().execute(
      () => this._doChat(messages, options),
      body.length,
    );
  }
}
