import { z } from "zod";

// --- Helpers ---

export const getRegionAtom = (
  description: string = "Administrative region, state, province, or equivalent.",
) =>
  z
    .object({
      code: z
        .string()
        .describe("Region or state code, if applicable. Example: ARA")
        .optional(),
      name: z
        .string()
        .describe("Region or state name. Example: Auvergne-Rhône-Alpes")
        .optional(),
    })
    .describe(description);

export const getCountryAtom = (description: string) =>
  z
    .object({
      code: z
        .string()
        .describe("Country code (ISO 3166-1 alpha-2). Example: FR")
        .optional(),
      name: z.string().describe("Country name. Example: France").optional(),
    })
    .describe(description);

// --- Shared Schemas ---

export const documentFaceSchema = z
  .enum(["front", "back", "both"])
  .describe(
    "Face of the scanned document. Front is the side with the photo and main information. Back is the side with additional information.",
  );

export const pageScopeSchema = z
  .enum(["first_page", "last_page", "all_pages", "partial"])
  .describe(
    "Scope of the pages included. 'first_page' determines if only the first page is present.",
  );

export const namesSchema = z
  .array(
    z.object({
      full: z
        .string()
        .describe(
          "Full name exactly as printed on the document. Example: Gilles André DUPONT",
        ),
      given: z.array(z.string()).describe("Given names in order.").optional(),
      family: z
        .array(z.string())
        .describe("Family names / surnames.")
        .optional(),
      birthFamily: z
        .array(z.string())
        .describe("Family name at birth, if different.")
        .optional(),
      type: z
        .enum([
          "legal",
          "birth",
          "married",
          "common",
          "preferred",
          "administrative",
          "alias",
          "transliterated",
        ])
        .describe("Type of name"),
      locale: z
        .string()
        .describe("Locale of the name representation (BCP 47).")
        .optional(),
    }),
  )
  .describe("Names of the document holder as recorded on the document.");

export const gendersSchema = z
  .array(
    z.object({
      type: z
        .enum([
          "legal",
          "administrative",
          "historical",
          "medical",
          "self_identified",
        ])
        .describe("Context in which the gender value applies.")
        .optional(),
      value: z
        .string()
        .describe("Gender value exactly as recorded. Example: M, F, X"),
      system: z.string().describe("Coding system used. Example: ISO/IEC 5218"),
      locale: z
        .string()
        .describe("Locale relevant to the gender representation.")
        .optional(),
    }),
  )
  .describe("Gender markers recorded on the document.");

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
          .describe("City of birth. Example: Saint-Étienne")
          .optional(),
        region: getRegionAtom("Region of birth.").optional(),
        country: getCountryAtom("Country of birth.").optional(),
      })
      .describe("Place of birth.")
      .optional(),
  })
  .describe("Birth information of the document holder.");

export const addressesSchema = z
  .array(
    z.object({
      full: z
        .string()
        .describe("Full address exactly as printed on the document."),
      type: z
        .enum([
          "legal",
          "administrative",
          "residential",
          "mailing",
          "historical",
        ])
        .describe("Context or usage of the address.")
        .optional(),
      street: z.string().describe("Street name and number.").optional(),
      building: z
        .string()
        .describe("Building, apartment, unit, floor.")
        .optional(),
      postalCode: z.string().describe("Postal or ZIP code.").optional(),
      city: z.string().describe("City, town, or municipality.").optional(),
      region: getRegionAtom().optional(),
      country: getCountryAtom("Country associated with the address."),
      locality: z
        .string()
        .describe("Free-form locality (district, village).")
        .optional(),
      validFrom: z
        .string()
        .describe("Date from which this address is valid (YYYY-MM-DD).")
        .optional(),
      validTo: z
        .string()
        .nullable()
        .describe("Date until which this address was valid.")
        .optional(),
    }),
  )
  .describe("Addresses of the document holder.");

export const issuingAuthoritySchema = z
  .string()
  .describe(
    "Authority that issued the document. Example: Préfecture de la Loire",
  );

export const datesSchema = z
  .object({
    issueDate: z
      .string()
      .describe("Date document was issued (YYYY-MM-DD).")
      .optional(),
    expiryDate: z
      .string()
      .describe("Date document expires (YYYY-MM-DD).")
      .optional(),
  })
  .describe("Important dates related to the document.");

export const periodSchema = z
  .object({
    startDate: z
      .string()
      .describe("Start date of the period (YYYY-MM-DD).")
      .optional(),
    endDate: z
      .string()
      .describe("End date of the period (YYYY-MM-DD).")
      .optional(),
  })
  .describe("Period of time for which the document is valid.");

export const SHARED_ZOD = {
  names: namesSchema,
  genders: gendersSchema,
  birth: birthSchema,
  addresses: addressesSchema,
  issuingAuthority: issuingAuthoritySchema,
  dates: datesSchema,
  period: periodSchema,
};
