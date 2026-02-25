import { z } from "zod";
import { DocumentTypeDefinition } from "../types.js";
import { pageScopeSchema, SHARED_ZOD } from "../shared.js";

export const residenceDefinitions: DocumentTypeDefinition[] = [
  {
    id: "residence.utility_bill",
    category: "residence",
    description: "Utility Bill (Generic - Energy, Water, Internet)",
    schema: z
      .object({
        pageScope: pageScopeSchema.optional(),
        providerName: z
          .string()
          .describe("Name of the provider/company.")
          .optional(),
        billDate: z
          .string()
          .describe("Date of the bill (YYYY-MM-DD).")
          .optional(),
        client: z
          .object({
            names: SHARED_ZOD.names.optional(),
            genders: SHARED_ZOD.genders.optional(),
            addresses: SHARED_ZOD.addresses.optional(),
          })
          .describe("Client details."),
      })
      .describe("Utility Bill extraction schema"),
  },
  {
    id: "residence.rent_receipt",
    category: "residence",
    description: "Rent Receipt",
    schema: z
      .object({
        pageScope: pageScopeSchema.optional(),
        receiptDate: z
          .string()
          .describe("Date of the receipt (YYYY-MM-DD).")
          .optional(),
        landlordName: z.string().describe("Name of the landlord.").optional(),
        tenant: z
          .object({
            names: SHARED_ZOD.names.optional(),
            genders: SHARED_ZOD.genders.optional(),
            addresses: SHARED_ZOD.addresses.optional(),
          })
          .describe("Tenant details."),
      })
      .describe("Rent Receipt extraction schema"),
  },
  {
    id: "residence.property_tax",
    category: "residence",
    description: "Property Tax Notice",
    schema: z
      .object({
        pageScope: pageScopeSchema.optional(),
        fiscalYear: z.string().describe("Fiscal year.").optional(),
        owner: z
          .object({
            names: SHARED_ZOD.names.optional(),
            genders: SHARED_ZOD.genders.optional(),
            addresses: SHARED_ZOD.addresses.optional(),
          })
          .describe("Owner details."),
      })
      .describe("Property Tax Notice extraction schema"),
  },
  {
    id: "residence.home_insurance",
    category: "residence",
    description: "Home Insurance Attestation",
    schema: z
      .object({
        pageScope: pageScopeSchema.optional(),
        insurerName: z
          .string()
          .describe("Name of the insurance company.")
          .optional(),
        policyNumber: z.string().describe("Policy number.").optional(),
        insured: z
          .object({
            names: SHARED_ZOD.names.optional(),
            genders: SHARED_ZOD.genders.optional(),
            addresses: SHARED_ZOD.addresses.optional(),
          })
          .describe("Insured details."),
        coveragePeriod: SHARED_ZOD.period.optional(),
      })
      .describe("Home Insurance Attestation extraction schema"),
  },
  {
    id: "residence.accommodation_attestation.fr",
    category: "residence",
    description: "Accommodation Attestation (Attestation d'Hébergement)",
    schema: z
      .object({
        pageScope: pageScopeSchema.optional(),
        hostName: z.string().describe("Name of the host.").optional(),
        hostedPersonName: z
          .string()
          .describe("Name of the hosted person.")
          .optional(),
        addresses: SHARED_ZOD.addresses
          .describe("Address of accommodation.")
          .optional(),
        dates: SHARED_ZOD.dates.optional(),
      })
      .describe("Accommodation Attestation extraction schema"),
  },
];
