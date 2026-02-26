/**
 * Dedicated provider for the 'mistral-ocr' pipeline endpoint.
 * Bypasses standard chat formatting, directly transmitting document images to the proprietary OCR API.
 *
 * @see architecture/details/document-types-and-processing.md - "Phase 10: LLM OCR"
 */

import type { ChatRequestOptions, ChatResponse } from "../types.js";
import { GenericProvider } from "./generic.js";
import { uploadFile, deleteFile } from "./mistral-files.js";
import { MistralBatchOcr } from "./mistral-batch-ocr.js";
import { MistralRateLimiter } from "./mistral-rate-limiter.js";

export class MistralOcrProvider extends GenericProvider {
  name = "mistral-ocr";

  async vision(
    systemPrompt: string,
    imageBuffer: ArrayBuffer,
    imageMimeType: string,
    options?: ChatRequestOptions,
  ): Promise<ChatResponse> {
    const document = options?.fileId
      ? {
          type: "file",
          file_id: options.fileId,
        }
      : {
          type: "image_url",
          image_url: {
            url: `data:${imageMimeType};base64,${Buffer.from(imageBuffer).toString("base64")}`,
          },
        };

    return this._ocr(document, options);
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

  async text(
    systemPrompt: string,
    userPrompt: string,
    options?: ChatRequestOptions,
  ): Promise<ChatResponse> {
    throw new Error("Mistral OCR provider does not support text-only mode");
  }

  protected async _ocr(
    document: any,
    options?: ChatRequestOptions,
  ): Promise<ChatResponse> {
    const model = options?.model || this.defaultModel;

    // Use Batch OCR only if explicitly enabled by environment variable
    const useBatch = process.env.MISTRAL_BATCH_OCR_ENABLED === "true";

    if (useBatch) {
      try {
        const batchOcr = MistralBatchOcr.getInstance();
        const result = await batchOcr.execute(document, model);

        const content = {
          extractedText: {
            contentType: "raw",
            content: result.pages[0]?.markdown || "",
          },
        };

        return {
          content: JSON.stringify(content),
          model: result.model || model,
          usage: {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            pages: result.pages.length,
          },
        };
      } catch (err) {
        console.warn(
          `[MistralOcrProvider] Batch OCR failed, falling back to direct call:`,
          err,
        );
        // Fall back to direct call
        return this._ocrDirect(document, model);
      }
    } else {
      return this._ocrDirect(document, model);
    }
  }

  private async _ocrDirect(
    document: any,
    model: string,
  ): Promise<ChatResponse> {
    const body = JSON.stringify({ model, document }, null, 2);

    return MistralRateLimiter.getInstance().execute(async () => {
      const requestHeaders = this._getRequestHeaders();

      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: requestHeaders,
        body,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(
          `${this.name} API error (${response.status}): ${error}`,
        );
      }

      const data = (await response.json()) as {
        pages: Array<{ markdown: string }>;
        model: string;
      };

      const content = {
        extractedText: {
          contentType: "raw",
          content: data.pages[0]?.markdown || "",
        },
      };

      return {
        content: JSON.stringify(content),
        model: data.model || model,
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          pages: data.pages.length,
        },
      };
    }, body);
  }
}
