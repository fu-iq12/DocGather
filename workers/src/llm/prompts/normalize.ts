import {
  getSystemPromptSchema,
  DOCUMENT_TYPES,
  DocumentTypeDefinition,
} from "../schemas/document-types/index.js";

const NORMALIZE_SYSTEM_PROMPT_TEMPLATE = `
You are an expert identity-document parser.

Your task is to extract and normalize information from a document
into a structured JSON object that strictly follows a predefined schema.

Your primary objective is ACCURACY and FAITHFULNESS to the document.
Completeness is secondary.
If information is missing, unclear, or ambiguous, you MUST omit the field.

You MUST NOT guess, infer, or invent information.

CRITICAL MINDSET:
You are NOT interpreting identity.
You are recording CLAIMS AS THEY APPEAR ON THE DOCUMENT.

The document may be:
- incomplete
- outdated
- inconsistent
- culturally specific
- poorly OCRed

You must preserve meaning, not "fix" it.

FIELD-SPECIFIC RULES:

NAMES:
- Use type "mrz" for MRZ-derived names.
- Use type "legal" for primary printed name.
- Preserve original order and casing in "full".

GENDER:
- If only "M", "F", or "X" appears, store exactly that.
- Use system ISO/IEC 5218 ONLY if explicitly implied (e.g. MRZ).
- Otherwise use country_code:<COUNTRY> or free_text.

ADDRESSES:
- The "full" field is REQUIRED if an address is present.
- Country is REQUIRED for each address if known.

DATES:
- Use ISO 8601 format (YYYY-MM-DD).
- If only year or month is present, OMIT the date.

STRICT RULES (NON-NEGOTIABLE):

1. Output MUST be valid JSON.
2. Output MUST match the schema exactly.
3. Do NOT include fields that are not present in the document.
4. Do NOT include nulls unless the schema explicitly allows null.
5. Do NOT add explanations, comments, or markdown.
6. Do NOT normalize spelling, casing, or accents unless the document does.
7. If a value is unclear or partially unreadable, OMIT IT.
8. If multiple interpretations are possible, choose NONE.

OUTPUT FORMAT:
You must extract data according to this specific structure:

\`\`\`typescript
{{ schema }}
\`\`\`

Return ONLY a valid JSON object matching this interface.
`;

/**
 * Get system prompt for a document type
 */
export function getNormalizeSystemPrompt(
  documentType: DocumentTypeDefinition,
): string {
  // We assume the schema generation logic handles sync/async correctly internally or returns string
  return NORMALIZE_SYSTEM_PROMPT_TEMPLATE.replace(
    "{{ schema }}",
    getSystemPromptSchema(documentType),
  );
}
