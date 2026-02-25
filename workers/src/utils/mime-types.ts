/**
 * Centralized MIME Type mappings and helper functions for DocGather Workers.
 * This ensures consistency across routing (orchestrator) and processing (format-conversion).
 */

export const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
  "image/tiff",
]);

export const PDF_MIME_TYPES = new Set(["application/pdf"]);

export const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/csv",
  "text/markdown",
]);

export const SPREADSHEET_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel.sheet.binary.macroEnabled.12", // .xlsb
  "application/vnd.ms-excel", // .xls
  "application/x-cfb", // legacy .xls
  "application/vnd.oasis.opendocument.spreadsheet", // .ods
  "application/vnd.apple.numbers", // .numbers
]);

export const WORD_MIME_TYPES = new Set([
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.oasis.opendocument.text", // .odt
  "application/vnd.apple.pages", // .pages
  "application/rtf", // .rtf
  "text/rtf", // .rtf
]);

export const PRESENTATION_MIME_TYPES = new Set([
  "application/vnd.ms-powerpoint", // .ppt
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "application/vnd.oasis.opendocument.presentation", // .odp
  "application/vnd.apple.keynote", // .key
]);

export const EMAIL_MIME_TYPES = new Set([
  "message/rfc822", // .eml
  "application/vnd.ms-outlook", // .msg
]);

export const XPS_MIME_TYPES = new Set([
  "application/vnd.ms-xpsdocument", // .xps
  "application/oxps", // .oxps
]);

// Helper Functions
export function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/") || IMAGE_MIME_TYPES.has(mimeType);
}

export function isPdf(mimeType: string): boolean {
  return PDF_MIME_TYPES.has(mimeType);
}

export function isTextDocument(mimeType: string): boolean {
  return mimeType.startsWith("text/") || TEXT_MIME_TYPES.has(mimeType);
}

export function isSpreadsheet(mimeType: string): boolean {
  return SPREADSHEET_MIME_TYPES.has(mimeType);
}

export function isEmail(mimeType: string): boolean {
  return EMAIL_MIME_TYPES.has(mimeType);
}

export function isXps(mimeType: string): boolean {
  return XPS_MIME_TYPES.has(mimeType);
}

/**
 * Groups all "Office" documents that currently route through format conversion.
 */
export function isOfficeDocument(mimeType: string): boolean {
  return (
    isSpreadsheet(mimeType) ||
    WORD_MIME_TYPES.has(mimeType) ||
    PRESENTATION_MIME_TYPES.has(mimeType) ||
    isEmail(mimeType) ||
    isXps(mimeType)
  );
}

/**
 * Defines which spreadsheets can be processed natively by extract_xlsx.py
 * vs requiring a LibreOffice conversion to .xlsx first.
 */
export function isNativeSpreadsheet(mimeType: string): boolean {
  return (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || // .xlsx
    mimeType === "application/vnd.ms-excel.sheet.binary.macroEnabled.12" // .xlsb
  );
}
