import { z } from "zod";

export interface DocumentTypeDefinition {
  id: string;
  category: "identity" | "residence" | "work" | "income" | "other";
  description: string;
  /** Zod Schema for validation and prompt generation */
  schema: z.ZodTypeAny;
}
