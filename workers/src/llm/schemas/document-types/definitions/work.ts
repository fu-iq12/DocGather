import { z } from "zod";
import { DocumentTypeDefinition } from "../types.js";
import { pageScopeSchema, SHARED_ZOD, documentFaceSchema } from "../shared.js";

export const workDefinitions: DocumentTypeDefinition[] = [
  {
    id: "work.employment_contract",
    category: "work",
    description: "Employment Contract (Generic)",
    schema: z
      .object({
        pageScope: pageScopeSchema.optional(),
        employerName: z.string().describe("Employer name.").optional(),
        employee: z
          .object({
            names: SHARED_ZOD.names.optional(),
            genders: SHARED_ZOD.genders.optional(),
            addresses: SHARED_ZOD.addresses.optional(),
            birth: SHARED_ZOD.birth.optional(),
            uniqueIdNumber: z
              .string()
              .describe("Unique personal ID number (e.g. SSN).")
              .optional(),
          })
          .describe("Employee details."),
        startDate: z.string().describe("Contract start date.").optional(),
        jobTitle: z.string().describe("Job title.").optional(),
      })
      .describe("Employment Contract schema"),
  },
  {
    id: "work.employment_contract.fr",
    category: "work",
    description: "French Employment Contract (ex: CDI/CDD)",
    schema: z
      .object({
        pageScope: pageScopeSchema.optional(),
        employerName: z.string().describe("Employer name.").optional(),
        employee: z
          .object({
            names: SHARED_ZOD.names.optional(),
            genders: SHARED_ZOD.genders.optional(),
            addresses: SHARED_ZOD.addresses.optional(),
            birth: SHARED_ZOD.birth.optional(),
            uniqueIdNumber: z
              .string()
              .describe("Unique personal ID number (e.g. SSN).")
              .optional(),
          })
          .describe("Employee details."),
        contractType: z
          .enum(["CDI", "CDD", "Interim", "Stage", "Alternance"])
          .describe("Type of contract.")
          .optional(),
        startDate: z.string().describe("Start date.").optional(),
        jobTitle: z.string().describe("Job title.").optional(),
        probationPeriod: SHARED_ZOD.period.optional(),
      })
      .describe("French Employment Contract schema"),
  },
  {
    id: "work.kbis.fr",
    category: "work",
    description: "French Kbis Extract (Extrait Kbis)",
    schema: z
      .object({
        pageScope: pageScopeSchema.optional(),
        companyName: z
          .string()
          .describe("Company Name (Dénomination).")
          .optional(),
        siren: z.string().describe("SIREN Number.").optional(),
        siret: z.string().describe("SIRET Number.").optional(),
        legalForm: z
          .string()
          .describe("Legal Form (Forme Juridique).")
          .optional(),
        addresses: SHARED_ZOD.addresses.optional(),
        dates: SHARED_ZOD.dates.optional(),
      })
      .describe("French Kbis Extract extraction schema"),
  },
  {
    id: "work.student_card",
    category: "work",
    description: "Student Card (Carte d'étudiant)",
    schema: z
      .object({
        documentFace: documentFaceSchema.optional(),
        student: z
          .object({
            names: SHARED_ZOD.names.optional(),
            genders: SHARED_ZOD.genders.optional(),
            birth: SHARED_ZOD.birth.optional(),
          })
          .describe("Student details."),
        institutionName: z
          .string()
          .describe("Institution/School Name.")
          .optional(),
        academicYear: z
          .string()
          .describe("Academic Year (e.g. 2023/2024).")
          .optional(),
        dates: SHARED_ZOD.dates.optional(),
      })
      .describe("Student Card extraction schema"),
  },
];
