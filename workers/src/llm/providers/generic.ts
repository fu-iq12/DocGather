/**
 * OVHcloud AI Endpoints Provider
 *
 * Uses OpenAI-compatible API for vision models:
 * - Mistral-Small-3.2-24B-Instruct-2506
 * - Qwen2.5-VL-72B-Instruct
 */

import type {
  LLMProvider,
  ChatMessage,
  ChatRequestOptions,
  ChatResponse,
} from "../types.js";

export class GenericProvider implements LLMProvider {
  name = "generic";

  constructor(
    protected endpoint: string,
    protected defaultModel: string,
    protected apiKey: string,
  ) {}

  async vision(
    systemPrompt: string,
    imageBuffer: ArrayBuffer,
    imageMimeType: string,
    options?: ChatRequestOptions,
  ): Promise<ChatResponse> {
    const userContent: any[] = [];
    userContent.push({
      type: "image_url",
      image_url: {
        url: `data:${imageMimeType};base64,${Buffer.from(imageBuffer).toString("base64")}`,
      },
    });

    const messages = [
      { role: "system" as const, content: systemPrompt },
      {
        role: "user" as const,
        content: userContent,
      },
    ] as ChatMessage[];
    return this._chat(messages, options);
  }

  async text(
    systemPrompt: string,
    userPrompt: string,
    options?: ChatRequestOptions,
  ): Promise<ChatResponse> {
    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userPrompt },
    ] as ChatMessage[];
    return this._chat(messages, options);
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
    };

    // Add response_format for structured outputs if provided
    if (options?.responseFormat) {
      requestBody.response_format = options.responseFormat;
    }

    return requestBody;
  }

  protected _getRequestHeaders(): any {
    const requestHeaders: Record<string, unknown> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      requestHeaders["Authorization"] = `Bearer ${this.apiKey}`;
    }

    return requestHeaders;
  }

  protected async _chat(
    messages: ChatMessage[],
    options?: ChatRequestOptions,
  ): Promise<ChatResponse> {
    return this._doChat(messages, options);
  }

  protected async _doChat(
    messages: ChatMessage[],
    options?: ChatRequestOptions,
  ): Promise<ChatResponse> {
    const model = options?.model || this.defaultModel;

    const requestBody = this._getRequestBody(messages, options);
    const requestHeaders = this._getRequestHeaders();

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.name} API error (${response.status}): ${error}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      model: string;
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };

    return {
      content: data.choices[0]?.message?.content || "",
      model: data.model || model,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    };
  }
}
