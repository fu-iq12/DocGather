import { z } from "zod";
import { SHARED_ZOD, getCountryAtom } from "./document-types/shared.js";
import { zodDeepPartial } from "zod-deep-partial";

const identitySchema = z.object({
  names: SHARED_ZOD.names,
  gender: SHARED_ZOD.gender,
  birth: SHARED_ZOD.birth,
  death: z
    .string()
    .describe("Date of death (YYYY-MM-DD). Example: 2026-02-12")
    .optional(),
});

const addressSchema = z.object({
  address: SHARED_ZOD.address,
  valid_from: z.string().optional().describe("YYYY-MM-DD"),
  valid_to: z.string().optional().describe("YYYY-MM-DD"),
});

const individualSchema = z.object({
  identity: identitySchema.describe("Individual identity").optional(),
  residence: z
    .array(addressSchema)
    .describe("Residence addresses history")
    .optional(),
});

const organizationSchema = z.object({
  name: z.string(),
  type: z.enum(["administration", "business", "non_profit", "other"]),
  address: SHARED_ZOD.address
    .describe("Address of the organization")
    .optional(),
});

const arbitrationsSchema = z
  .record(
    z.string().describe("Property path"),
    z.object({
      candidates: z.array(z.string()),
      best: z.string(),
      confidence: z.number(),
      reasoning: z.string(),
    }),
  )
  .describe(
    "Describe arbitrations when merging conflicting property values from different sources",
  );

export const kgMutationSchema = z.object({
  mutations: z
    .object({
      entities: z
        .array(
          z.object({
            id: z
              .string()
              .describe(
                "The exact UUID of the existing entity or a temporary string ID like 'e_new_1' to reference in relationships within this mutation",
              ),
            data: zodDeepPartial(
              z.object({
                individual: individualSchema
                  .describe("Data for individuals")
                  .optional(),
                organization: organizationSchema
                  .describe("Data for organizations")
                  .optional(),
              }),
            ),
            arbitrations: arbitrationsSchema.optional(),
          }),
        )
        .optional()
        .describe("Entities to create or update"),

      relationships: z
        .array(
          z.object({
            id: z
              .string()
              .describe(
                "The exact UUID of the existing entity or a temporary string ID like 'e_new_1_e_new_2' to reference in attributions",
              ),
            type: z
              .string()
              .describe("Relationship type in category:subtype format"),
            source: z.string().describe("UUID or temp_id of the source entity"),
            target: z.string().describe("UUID or temp_id of the target entity"),
            valid_from: z
              .string()
              .optional()
              .describe(
                "Start date of the relationship (YYYY-MM-DD or YYYY-MM)",
              ),
            valid_to: z
              .string()
              .optional()
              .describe(
                "End date of the relationship (reasons: expired, dissolved, ...etc)",
              ),
            data: z
              .record(
                z.string(),
                z.union([z.string(), z.number(), z.boolean()]),
              )
              .optional()
              .describe("Relationship data fields. Only simple values allowed"),
          }),
        )
        .optional()
        .describe("New relationships between entities"),
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
