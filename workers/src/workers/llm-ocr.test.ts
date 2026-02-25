/**
 * Tests for llm-ocr worker (formerly image-text-extraction)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SubtaskInput } from "../types.js";

// Mock LLM client
const mockOcr = vi.fn();
vi.mock("../llm/index.js", () => ({
  LLMClient: vi.fn().mockImplementation(() => ({
    providerName: "mock",
    vision: mockOcr,
    ocr: mockOcr,
  })),
}));

// Add static method mock
import { LLMClient } from "../llm/index.js";
(LLMClient as any).createVisionMessages = vi.fn().mockReturnValue([
  { role: "system", content: "test" },
  { role: "user", content: [] },
]);

// Mock supabase
const mockDownloadFile = vi.fn();
vi.mock("../supabase.js", () => ({
  downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
}));

// Mock queues
vi.mock("../queues.js", () => ({
  connection: {},
}));

vi.mock("../llm/billing.js", () => ({
  trackLlmUsage: vi.fn().mockResolvedValue(undefined),
}));

// Mock schema parsing if needed, but integration with Zod is better if possible.
// We mocked the module relative path, so we can mock the export.
// Actually, let's keep Zod real to test validation logic if possible.
// But we need to update the import path in the mocked file vs test file.
// The worker imports from `../schemas/llm-responses.js`.

// Import worker
const { processLlmOcrJob, parseResponse } = await import("./llm-ocr.js");

describe("llm-ocr worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parseResponse", () => {
    it("should parse valid JSON response with new format", () => {
      const json = JSON.stringify({
        documentDescription: "French national ID card",
        language: "fr",
        extractedText: {
          contentType: "raw",
          content: "RÉPUBLIQUE FRANÇAISE...",
        },
      });

      const result = parseResponse(json);

      expect(result.language).toBe("fr");
      expect(result.extractedText.contentType).toBe("raw");
    });

    it("should extract JSON from markdown code block", () => {
      const response = `Here is the analysis:
\`\`\`json
{
  "documentDescription": "French payslip",
  "language": "fr",
  "extractedText": {
    "contentType": "raw",
    "content": "Bulletin de paie..."
  }
}
\`\`\``;

      const result = parseResponse(response);

      expect(result.extractedText.content).toBe("Bulletin de paie...");
    });

    it("should throw on invalid JSON", () => {
      const badResponse = "I couldn't process this image properly.";

      expect(() => parseResponse(badResponse)).toThrow(
        "Failed to parse LLM response as JSON",
      );
    });
  });

  describe("processLlmOcrJob", () => {
    it("should skip if no scaled images", async () => {
      const job = {
        data: {
          documentId: "doc-123",
          ownerId: "user-456",
          mimeType: "image/jpeg",
          originalFileId: "file-789",
          originalPath: "path/to/file.jpg",
          // No scaledImagePaths
        } as SubtaskInput,
        name: "llm-ocr",
      };

      const result = await processLlmOcrJob(job as any);

      expect(result.rawText).toBe("");
      // expect(result.documentType).toBe("other.unclassified");
      expect(mockOcr).not.toHaveBeenCalled();
    });

    it("should extract text and identify document type", async () => {
      mockDownloadFile.mockResolvedValue(new ArrayBuffer(100));
      mockOcr.mockResolvedValue({
        content: JSON.stringify({
          documentDescription: "French national ID card (CNI) - front and back",
          language: "fr",
          extractedText: {
            contentType: "raw",
            content:
              "RÉPUBLIQUE FRANÇAISE\nCARTE NATIONALE D'IDENTITÉ\nNom: DUPONT\nPrénom: Jean",
          },
        }),
        model: "test-model",
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      });

      const job = {
        data: {
          documentId: "doc-123",
          ownerId: "user-456",
          mimeType: "image/jpeg",
          originalFileId: "file-789",
          originalPath: "path/to/file.jpg",
          scaledImagePaths: [
            "user-456/doc-123/scaled_0.webp",
            "user-456/doc-123/scaled_1.webp",
          ],
        } as SubtaskInput,
        name: "llm-ocr",
      };

      const result = await processLlmOcrJob(job as any);

      // expect(result.documentType).toBe("identity.national_id");
      expect(result.documentDescription).toContain("French national ID");
      expect(result.language).toBe("fr");
      expect(result.rawText).toContain("RÉPUBLIQUE FRANÇAISE");
      expect(result.pageCount).toBe(2);
      expect(mockOcr).toHaveBeenCalled();
    });

    it("should handle structured extractedText (object format)", async () => {
      mockDownloadFile.mockResolvedValue(new ArrayBuffer(100));
      mockOcr.mockResolvedValue({
        content: JSON.stringify({
          documentDescription: "French national ID card",
          language: "fr",
          extractedText: {
            contentType: "structured",
            content: {
              frontSide: {
                lastName: "DUPONT",
                firstName: "Jean",
                birthDate: "01.01.1990",
              },
              backSide: {
                address: "123 Rue de Paris",
              },
            },
          },
        }),
        model: "test-model",
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      });

      const job = {
        data: {
          documentId: "doc-123",
          ownerId: "user-456",
          mimeType: "image/jpeg",
          originalFileId: "file-789",
          originalPath: "path/to/file.jpg",
          scaledImagePaths: ["user-456/doc-123/scaled_0.webp"],
        } as SubtaskInput,
        name: "llm-ocr",
      };

      const result = await processLlmOcrJob(job as any);

      expect(result.structuredData).not.toBeNull();
      // expect(result.documentTypeConfidence).toBe(0.95);
      expect(result.rawText).toContain("DUPONT");
    });
  });
});
