import { z } from "zod";

// --- Helpers ---

export const getRegionAtom = (
  description: string = "Administrative region, state, province, or equivalent",
) =>
  z
    .string()
    .regex(/^[A-Z]{2}-.{2,}$/)
    .describe(`${description.replace(/\.$/, "")} (ISO 3166-2). Example: US-CA`);

export const getCountryAtom = (description: string) =>
  z
    .string()
    .length(2)
    .describe(
      `${description.replace(/\.$/, "")} (ISO 3166-1 alpha-2). Example: FR`,
    );

// --- Shared Schemas ---

export const documentFaceSchema = z
  .enum(["front", "back", "both"])
  .describe(
    "Face of the scanned document. Front is the side with the photo and main information. Back is the side with additional information",
  );

export const pageScopeSchema = z
  .enum(["first_page", "last_page", "all_pages", "partial"])
  .describe(
    "Scope of the pages included. 'first_page' determines if only the first page is present",
  );

export const namesSchema = z
  .object({
    full: z.string().describe("Full name. Example: Jean André DUPONT"),
    given: z.array(z.string()).describe("Given names in order").optional(),
    family: z.array(z.string()).describe("Family names / surnames").optional(),
    birthFamily: z
      .array(z.string())
      .describe("Family name at birth, if explicitly provided")
      .optional(),
  })
  .describe("Names of the document holder as recorded on the document");

export const genderSchema = z
  .enum(["male", "female", "non_binary", "other", "prefer_not_to_say"])
  .describe("Gender marker recorded on the document");

export const birthSchema = z
  .object({
    date: z
      .string()
      .describe("Date of birth (YYYY-MM-DD). Example: 1980-01-01")
      .optional(),
    place: z
      .object({
        city: z
          .string()
          .describe("City of birth if explicitly provided")
          .optional(),
        region: getRegionAtom(
          "State or region of birth if explicitly provided",
        ).optional(),
        country: getCountryAtom(
          "Country of birth if explicitly provided",
        ).optional(),
      })
      .describe("Place of birth")
      .optional(),
  })
  .describe("Birth information of the document holder");

export const addressSchema = z
  .object({
    type: z
      .enum(["legal", "administrative", "residential", "mailing", "historical"])
      .describe("Context or usage of the address")
      .optional(),
    street: z.string().describe("Street name and number").optional(),
    building: z
      .string()
      .describe("Building, apartment, unit, floor")
      .optional(),
    postalCode: z.string().describe("Postal or ZIP code").optional(),
    city: z.string().describe("City, town, or municipality").optional(),
    region: getRegionAtom().optional(),
    country: getCountryAtom("Country associated with the address"),
    locality: z
      .string()
      .describe("Free-form locality (district, village)")
      .optional(),
    validFrom: z
      .string()
      .describe("Date from which this address is valid (YYYY-MM-DD)")
      .optional(),
    validTo: z
      .string()
      .nullable()
      .describe("Date until which this address was valid")
      .optional(),
  })
  .describe("Address of the document holder");

export const issuingAuthoritySchema = z
  .string()
  .describe(
    "Authority that issued the document. Example: Préfecture de la Loire",
  );

export const datesSchema = z
  .object({
    issueDate: z
      .string()
      .describe("Date document was issued (YYYY-MM-DD)")
      .optional(),
    expiryDate: z
      .string()
      .describe("Date document expires (YYYY-MM-DD)")
      .optional(),
  })
  .describe("Important dates related to the document");

export const periodSchema = z
  .object({
    startDate: z
      .string()
      .describe("Start date of the period (YYYY-MM-DD)")
      .optional(),
    endDate: z
      .string()
      .describe("End date of the period (YYYY-MM-DD)")
      .optional(),
  })
  .describe("Period of time for which the document is valid");

export const SHARED_ZOD = {
  names: namesSchema,
  gender: genderSchema,
  birth: birthSchema,
  address: addressSchema,
  issuingAuthority: issuingAuthoritySchema,
  dates: datesSchema,
  period: periodSchema,
} as const;
