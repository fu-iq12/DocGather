import { z } from "zod";

// --- OCR Schema ---

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
