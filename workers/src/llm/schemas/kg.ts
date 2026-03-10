import { z } from "zod";

const entityActionSchema = z.enum(["set", "append", "remove"]);

const fieldValueSchema = z.object({
  value: z.any().describe("The value of the field"),
  confidence: z.number().describe("Confidence score (0.0 to 1.0)"),
});

const fieldChangeSchema = z.object({
  action: entityActionSchema,
  value: fieldValueSchema.describe(
    "The new value or object to merge/append/remove. Should include a `value` and `confidence` score (0.0 to 1.0)",
  ),
});

export const kgMutationSchema = z.object({
  mutations: z
    .object({
      entities_to_add: z
        .array(
          z.object({
            temp_id: z
              .string()
              .describe(
                "A temporary string ID like 'e_new_1' to reference in relationships within this mutation",
              ),
            type: z
              .enum(["individual", "business", "administration", "non_profit"])
              .describe("The type of entity"),
            data: z
              .record(z.string(), fieldValueSchema)
              .describe(
                "Entity properties. Nested objects. E.g. { first_name: { value: 'Jean', confidence: 0.9 } }",
              ),
          }),
        )
        .optional()
        .describe("New entities to create in the graph"),

      entities_to_update: z
        .array(
          z.object({
            id: z.string().describe("The exact UUID of the existing entity"),
            field_changes: z
              .record(z.string(), fieldChangeSchema)
              .describe(
                "Map of field paths (e.g. 'first_name', 'addresses') to the changes to apply",
              ),
          }),
        )
        .optional()
        .describe("Updates to existing entities"),

      relationships_to_add: z
        .array(
          z.object({
            temp_id: z
              .string()
              .describe("A temporary string ID like 'r_new_1'"),
            type: z
              .string()
              .describe(
                "Relationship type (e.g. employee, marriage, tenant, beneficiary)",
              ),
            source: z.string().describe("UUID or temp_id of the source entity"),
            target: z.string().describe("UUID or temp_id of the target entity"),
            valid_from: z
              .string()
              .optional()
              .describe("YYYY-MM-DD or YYYY-MM if known"),
            data: z
              .record(z.string(), z.any())
              .optional()
              .describe(
                "Additional relationship data fields (nested with confidence)",
              ),
          }),
        )
        .optional()
        .describe("New relationships between entities"),

      relationships_to_update: z
        .array(
          z.object({
            id: z.string().describe("The UUID of the existing relationship"),
            field_changes: z
              .record(z.string(), fieldChangeSchema)
              .describe("Map of field paths (e.g. 'data.salary') to update"),
          }),
        )
        .optional()
        .describe("Updates to existing relationships"),

      relationships_to_close: z
        .array(
          z.object({
            id: z.string().describe("The UUID of the relationship to close"),
            valid_to: z
              .string()
              .describe("YYYY-MM-DD marking the end date of the relationship"),
          }),
        )
        .optional()
        .describe(
          "Close explicitly expired relationships (do not destroy, just mark valid_to)",
        ),
    })
    .describe(
      "The set of graph mutations mapping new unstructured data to structured nodes/edges",
    ),

  attributions: z
    .array(
      z.object({
        document_id: z.string().describe("UUID of the newly ingested document"),
        targets: z.array(
          z.object({
            target_type: z.enum(["entity", "relationship"]),
            target_id: z
              .string()
              .describe("UUID or temp_id of the target node or edge"),
            role: z
              .string()
              .optional()
              .describe(
                "Role of the document (subject, issuer, proof, recipient)",
              ),
          }),
        ),
      }),
    )
    .describe(
      "Link newly processed documents to the graph entities they prove or affect",
    ),

  reasoning: z
    .string()
    .describe(
      "Brief explanation of the logic used to generate these mutations",
    ),
});

export type KgMutationResponse = z.infer<typeof kgMutationSchema>;
