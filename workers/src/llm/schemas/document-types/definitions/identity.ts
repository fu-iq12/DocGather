import { z } from "zod";
import { DocumentTypeDefinition } from "../types.js";
import { documentFaceSchema, SHARED_ZOD, getCountryAtom } from "../shared.js";

export const identityDefinitions: DocumentTypeDefinition[] = [
  {
    id: "identity.national_id",
    category: "identity",
    description: "National ID Card",
    schema: z
      .object({
        documentFace: documentFaceSchema.optional(),
        documentNumber: z
          .string()
          .describe("Official document number.")
          .optional(),
        uniqueIdNumber: z
          .string()
          .describe("Unique personal ID number (e.g. SSN).")
          .optional(),
        mrz: z.string().describe("Machine Readable Zone text.").optional(),
        names: SHARED_ZOD.names.optional(),
        genders: SHARED_ZOD.genders.optional(),
        birth: SHARED_ZOD.birth.optional(),
        nationality: getCountryAtom("Nationality of the holder.").optional(),
        addresses: SHARED_ZOD.addresses.optional(),
        dates: SHARED_ZOD.dates.optional(),
        issuingAuthority: SHARED_ZOD.issuingAuthority.optional(),
        issuingCountry: getCountryAtom(
          "Country that issued the document.",
        ).optional(),
      })
      .describe("National Identity Card extraction schema"),
  },
  {
    id: "identity.passport",
    category: "identity",
    description: "Passport (Generic / ICAO)",
    schema: z
      .object({
        documentFace: documentFaceSchema.optional(),
        documentNumber: z.string().describe("Passport number.").optional(),
        mrz: z.string().describe("MRZ text.").optional(),
        names: SHARED_ZOD.names.optional(),
        genders: SHARED_ZOD.genders.optional(),
        birth: SHARED_ZOD.birth.optional(),
        nationality: getCountryAtom("Nationality.").optional(),
        dates: SHARED_ZOD.dates.optional(),
        issuingCountry: getCountryAtom("Issuing Country.").optional(),
        issuingAuthority: SHARED_ZOD.issuingAuthority.optional(),
      })
      .describe("Passport extraction schema"),
  },
  {
    id: "identity.residence_permit",
    category: "identity",
    description: "Residence Permit",
    schema: z
      .object({
        documentFace: documentFaceSchema.optional(),
        permitNumber: z.string().describe("Permit number.").optional(),
        type: z.string().describe("Type of permit.").optional(),
        names: SHARED_ZOD.names.optional(),
        genders: SHARED_ZOD.genders.optional(),
        dates: SHARED_ZOD.dates.optional(),
        issuingCountry: getCountryAtom("Issuing Country.").optional(),
        issuingAuthority: SHARED_ZOD.issuingAuthority.optional(),
      })
      .describe("Residence Permit extraction schema"),
  },
  {
    id: "identity.drivers_license",
    category: "identity",
    description: "Driver's License",
    schema: z
      .object({
        documentFace: documentFaceSchema.optional(),
        licenseNumber: z.string().describe("License number.").optional(),
        names: SHARED_ZOD.names.optional(),
        genders: SHARED_ZOD.genders.optional(),
        birth: SHARED_ZOD.birth.optional(),
        dates: SHARED_ZOD.dates.optional(),
        issuingCountry: getCountryAtom("Issuing Country.").optional(),
        issuingAuthority: SHARED_ZOD.issuingAuthority.optional(),
      })
      .describe("Driver's License extraction schema"),
  },
  {
    id: "identity.family_record.fr",
    category: "identity",
    description: "French Family Record Book (Livret de Famille)",
    schema: z
      .object({
        pageScope: z
          .enum(["parents_page", "children_page"])
          .describe("Scope of the pages included."),
        parents: z
          .array(SHARED_ZOD.names)
          .describe("Parents details.")
          .optional(),
        children: z
          .array(SHARED_ZOD.names)
          .describe("Children listed.")
          .optional(),
        marriage: z
          .object({
            date: z.string().optional(),
            place: z.string().optional(),
          })
          .describe("Marriage details.")
          .optional(),
        issuingAuthority: SHARED_ZOD.issuingAuthority.optional(),
      })
      .describe("Family Record Book extraction schema"),
  },
];
