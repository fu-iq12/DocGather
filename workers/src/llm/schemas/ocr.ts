import { z } from "zod";

/**
 * Structural definition for LLM-based OCR outputs.
 * Separates raw text from structured blocks (tables, sections) and captures language metadata.
 */
export const llmOcrSchema = z.object({
  documentDescription: z
    .string()
    .optional()
    .describe(
      "Human readable description. Be detailed about the document type.",
    ),
  language: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Language(s)"),
  extractedText: z.object({
    contentType: z.enum(["structured", "raw"]),
    content: z.union([z.string(), z.record(z.string(), z.unknown())]),
  }),
});

export type LlmOcrResponse = z.infer<typeof llmOcrSchema>;
