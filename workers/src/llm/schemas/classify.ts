import { z } from "zod";
import { DOCUMENT_TYPES } from "./document-types/index.js";

/**
 * Zod schema defining the output constraint for the classification agent.
 * Maps dynamic taxonomy definitions into a strict Zod enum to prevent hallucinated types.
 */
const validDocumentTypes = [...DOCUMENT_TYPES.map((t) => t.id)] as const;

const docTypeEnum = z.enum(
  validDocumentTypes as unknown as [string, ...string[]],
);

export const llmClassificationSchema = z
  .object({
    documentType: docTypeEnum.describe(
      "Document type in category.subcategory format (e.g., identity.national_id, income.payslip)",
    ),
    // confidence: z
    //   .number()
    //   .min(0)
    //   .max(1)
    //   .describe("Confidence in classification (0.0-1.0)"),
    language: z.string().describe("ISO 639-1 language code (e.g. en, fr)"),
    // issuerHint: z
    //   .string()
    //   .optional()
    //   .describe("Name of the issuing organization/entity if visible"),
    // dateHint: z
    //   .string()
    //   .optional()
    //   .describe("Document date if visible (YYYY-MM-DD or relevant text)"),
    explanation: z.string().describe("Brief reason for this classification"),
    extractionConfidence: z
      .number()
      .min(0)
      .max(1)
      .describe(
        "Confidence (0.0–1.0) that the provided data is reliable enough to generate a trustworthy structured data card",
      ),
    documentSummary: z
      .string()
      .describe("A very short summary of the document"),
  })
  .describe("Classification response");

export type LlmClassificationResponse = z.infer<typeof llmClassificationSchema>;
