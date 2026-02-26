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
import { uploadFile, deleteFile } from "./mistral-files.js";

export class MistralProvider extends GenericProvider {
  name = "mistral";

  async vision(
    systemPrompt: string,
    imageBuffer: ArrayBuffer,
    imageMimeType: string,
    options?: ChatRequestOptions,
  ): Promise<ChatResponse> {
    const userContent: any[] = [];

    if (options?.fileId) {
      userContent.push({
        type: "file",
        file_id: options.fileId,
      });
    } else {
      userContent.push({
        type: "image_url",
        image_url: {
          url: `data:${imageMimeType};base64,${Buffer.from(imageBuffer).toString("base64")}`,
        },
      });
    }

    const messages = [
      { role: "system" as const, content: systemPrompt },
      {
        role: "user" as const,
        content: userContent,
      },
    ] as ChatMessage[];

    return this._chat(messages, options);
  }

  async upload(
    documentId: string,
    imageBuffer: ArrayBuffer,
    imageMimeType: string,
    purpose: "ocr" = "ocr",
  ): Promise<string | undefined> {
    const ext = imageMimeType.split("/")[1] || "bin";
    const fileName = `document-${documentId}.${ext}`;
    return uploadFile(
      this.apiKey,
      imageBuffer,
      imageMimeType,
      fileName,
      purpose,
    );
  }

  async delete(fileId: string): Promise<void> {
    return deleteFile(this.apiKey, fileId);
  }

  protected async _chat(
    messages: ChatMessage[],
    options?: ChatRequestOptions,
  ): Promise<ChatResponse> {
    const body = JSON.stringify(this._getRequestBody(messages, options));
    return MistralRateLimiter.getInstance().execute(
      () => this._doChat(messages, options),
      body,
    );
  }
}
