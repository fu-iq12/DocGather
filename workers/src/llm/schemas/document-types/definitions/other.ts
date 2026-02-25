import { z } from "zod";
import { DocumentTypeDefinition } from "../types.js";

export const otherDefinitions: DocumentTypeDefinition[] = [
  {
    id: "other.unclassified",
    category: "other",
    description: "Administrative document not represented in the taxonomy",
    schema: z
      .object({
        summary: z
          .string()
          .describe("Brief summary of the document content.")
          .optional(),
      })
      .describe("Unknown document schema"),
  },
  {
    id: "other.irrelevant",
    category: "other",
    description: "Non-administrative or unrelated file",
    schema: z
      .object({
        summary: z
          .string()
          .describe("Brief summary of the document content.")
          .optional(),
      })
      .describe("Unknown document schema"),
  },
];
