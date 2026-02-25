import { z } from "zod";
import { DocumentTypeDefinition } from "../types.js";
import { pageScopeSchema, SHARED_ZOD } from "../shared.js";

export const incomeDefinitions: DocumentTypeDefinition[] = [
  {
    id: "income.payslip",
    category: "income",
    description: "Payslip",
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
        payPeriod: SHARED_ZOD.period.optional(),
      })
      .describe("Payslip schema"),
  },
  {
    id: "income.tax_notice",
    category: "income",
    description: "Tax Notice",
    schema: z
      .object({
        pageScope: pageScopeSchema.optional(),
        fiscalYear: z.string().describe("Fiscal year.").optional(),
        addressee: z
          .object({
            names: SHARED_ZOD.names.optional(),
            genders: SHARED_ZOD.genders.optional(),
            addresses: SHARED_ZOD.addresses.optional(),
          })
          .describe("Addressee details."),
        taxpayers: z
          .array(
            z.object({
              names: SHARED_ZOD.names.optional(),
              genders: SHARED_ZOD.genders.optional(),
            }),
          )
          .describe("Taxpayer details. May be more than one."),
      })
      .describe("Tax Notice schema"),
  },
  {
    id: "income.bank_statement",
    category: "income",
    description: "Bank Statement",
    schema: z
      .object({
        pageScope: pageScopeSchema.optional(),
        bankName: z.string().describe("Name of the bank.").optional(),
        bankStatementPeriod: SHARED_ZOD.period.optional(),
        accountNumber: z.string().describe("Account number.").optional(),
        accountHolder: z
          .object({
            names: SHARED_ZOD.names.optional(),
            genders: SHARED_ZOD.genders.optional(),
            addresses: SHARED_ZOD.addresses.optional(),
          })
          .describe("Account holder details."),
      })
      .describe("Bank Statement extraction schema"),
  },
  {
    id: "income.bank_account_details",
    category: "income",
    description: "Bank Account Details",
    schema: z
      .object({
        pageScope: pageScopeSchema.optional(),
        bankName: z.string().describe("Name of the bank.").optional(),
        accountNumber: z.string().describe("Account number.").optional(),
        accountHolder: z
          .object({
            names: SHARED_ZOD.names.optional(),
            genders: SHARED_ZOD.genders.optional(),
            addresses: SHARED_ZOD.addresses.optional(),
          })
          .describe("Account holder details."),
        iban: z.string().describe("IBAN.").optional(),
        bic: z.string().describe("BIC/SWIFT.").optional(),
      })
      .describe("Bank Account Details extraction schema"),
  },
  {
    id: "income.social_payment",
    category: "income",
    description: "Social Payment Attestation",
    schema: z
      .object({
        pageScope: pageScopeSchema.optional(),
        issuingAuthority: z
          .string()
          .describe("Name of the issuing authority.")
          .optional(),
        beneficiary: z
          .object({
            names: SHARED_ZOD.names.optional(),
            genders: SHARED_ZOD.genders.optional(),
            addresses: SHARED_ZOD.addresses.optional(),
          })
          .describe("Beneficiary details."),
        period: SHARED_ZOD.period.optional(),
        dates: SHARED_ZOD.dates.optional(),
      })
      .describe("Social Payment Attestation extraction schema"),
  },
];
