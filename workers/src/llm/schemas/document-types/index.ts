import { z } from "zod";
import { zodToTs } from "../utils.js";
import { DocumentTypeDefinition } from "./types.js";
import { identityDefinitions } from "./definitions/identity.js";
import { residenceDefinitions } from "./definitions/residence.js";
import { workDefinitions } from "./definitions/work.js";
import { incomeDefinitions } from "./definitions/income.js";
import { otherDefinitions } from "./definitions/other.js";

// Re-export shared types and helpers
export * from "./types.js";
export * from "./shared.js";
export * from "./definitions/identity.js";
export * from "./definitions/residence.js";
export * from "./definitions/work.js";
export * from "./definitions/income.js";
export * from "./definitions/other.js";

// --- Document Types Registry ---

export const DOCUMENT_TYPES: DocumentTypeDefinition[] = [
  ...identityDefinitions,
  ...residenceDefinitions,
  ...workDefinitions,
  ...incomeDefinitions,
  ...otherDefinitions,
] as const;

// --- Helper Functions ---

/**
 * Generate taxonomy text for System Prompt
 */
export function getSystemPromptTaxonomy(): string {
  const categories = new Set(DOCUMENT_TYPES.map((d) => d.category));
  let output = "";

  categories.forEach((cat) => {
    output += `- ${cat.toUpperCase()}:\n`;
    DOCUMENT_TYPES.filter((d) => d.category === cat).forEach((d) => {
      output += `  - ${d.id}: ${d.description}\n`;
    });
  });

  return output;
}

/**
 * Generate plain english schema for System Prompt using Zod-to-TS
 */
export function getSystemPromptSchema(
  documentType: DocumentTypeDefinition,
): string {
  return zodToTs(documentType.schema, "ExtractionResult");
}

/**
 * Get schema for a document type
 */
export function getDocumentSchema(typeId: string): z.ZodTypeAny {
  const def = DOCUMENT_TYPES.find((d) => d.id === typeId);
  return def
    ? def.schema
    : DOCUMENT_TYPES.find((d) => d.id === "other.unclassified")!.schema;
}
