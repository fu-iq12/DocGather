import { z } from "zod";
import prettier from "@prettier/sync";

/**
 * Convert Zod Schema to TypeScript Interface definition string with JSDoc comments.
 * Used for System Prompts.
 */
export function zodToTs(schema: z.ZodTypeAny, name: string) {
  return prettier.format(`interface ${name} ${printNode(schema)}`, {
    parser: "typescript",
  });
}

function printNode(schema: z.ZodTypeAny, indent = 0): string {
  const pad = "  ".repeat(indent);

  // Handle optional/nullable wrappers
  let inner: z.ZodTypeAny = schema;

  // Unwrap optional/nullable
  // Using loop to handle multiple wrappings if any (though usually just one)
  // Casting to proper types to access methods
  while (inner instanceof z.ZodOptional || inner instanceof z.ZodNullable) {
    if (inner instanceof z.ZodOptional) {
      inner = (inner as z.ZodOptional<z.ZodTypeAny>).unwrap();
    } else if (inner instanceof z.ZodNullable) {
      inner = (inner as z.ZodNullable<z.ZodTypeAny>).unwrap();
    }
  }

  if (inner instanceof z.ZodString) {
    return "string";
  }
  if (inner instanceof z.ZodNumber) {
    return "number";
  }
  if (inner instanceof z.ZodBoolean) {
    return "boolean";
  }
  if (inner instanceof z.ZodDate) {
    return "string"; // ISO Date string
  }

  if (inner instanceof z.ZodArray) {
    // cast inner to ZodArray
    const arr = inner as z.ZodArray<z.ZodTypeAny>;
    const itemType = printNode(arr.element, indent);
    return `${itemType}[]`;
  }

  if (inner instanceof z.ZodObject) {
    const obj = inner as z.ZodObject<any>;
    const props = obj.shape;
    const lines = Object.entries(props).map(([key, value]) => {
      const fieldSchema = value as z.ZodTypeAny;

      let description = fieldSchema.description;
      // Unwrap if description is missing
      let temp = fieldSchema;
      while (
        !description &&
        (temp instanceof z.ZodOptional || temp instanceof z.ZodNullable)
      ) {
        if (temp instanceof z.ZodOptional)
          temp = (temp as z.ZodOptional<any>).unwrap();
        else temp = (temp as z.ZodNullable<any>).unwrap();
        description = temp.description;
      }

      const fieldDesc = description ? `  /** ${description} */\n` : "";

      const isFieldOptional = fieldSchema.isOptional();
      const typeStr = printNode(fieldSchema, indent + 1);

      return `${pad}  ${fieldDesc}${pad}  ${key}${isFieldOptional ? "?" : ""}: ${typeStr};`;
    });
    return `{\n${lines.join("\n")}\n${pad}}`;
  }

  if (inner instanceof z.ZodEnum) {
    const enm = inner as unknown as { options: string[] };
    return enm.options.map((o) => `"${o}"`).join(" | ");
  }

  if (inner instanceof z.ZodUnion) {
    const union = inner as z.ZodUnion<any>;
    return union.options
      .map((o: z.ZodTypeAny) => printNode(o, indent))
      .join(" | ");
  }

  if (inner instanceof z.ZodLiteral) {
    const lit = inner as z.ZodLiteral;
    return String(lit.value);
  }

  return "any";
}
