/**
 * MIME Classification Service
 * Inspects file magic bytes and structure to authoritatively determine true document formats.
 *
 * @see architecture/details/document-types-and-processing.md - "MIME Types taxonomy"
 */

import { fileTypeFromBuffer } from "https://esm.sh/file-type@19.6.0";
// @deno-types="https://esm.sh/v135/@types/mime-types@2.1.4/index.d.ts"
import mimeTypes from "https://esm.sh/mime-types@2.1.35";

/**
 * Result of MIME type detection.
 */
export interface MimeDetectionResult {
  /** Detected MIME type (e.g., "application/pdf") */
  mimeType: string;
  /** File extension without dot (e.g., "pdf") */
  extension: string;
  /** Whether detection was from magic bytes (true) or fallback (false) */
  fromMagicBytes: boolean;
}

/**
 * Allowed MIME type prefixes for document upload.
 * Comprehensive list for DocGather document processing.
 * @see docs/architecture/details/document-types-and-processing.md
 */
const ALLOWED_MIME_PREFIXES = [
  // PDF
  "application/pdf",

  // All images
  "image/",

  // Microsoft Office (all variants)
  "application/msword",
  "application/vnd.openxmlformats-officedocument",
  "application/vnd.ms-",
  "application/x-cfb", // legacy .doc/.xls/.ppt (Compound File Binary)

  // OpenDocument (LibreOffice)
  "application/vnd.oasis.opendocument",

  // Apple formats
  "application/vnd.apple",

  // Text-based
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/html",
  "text/rtf",
  "application/rtf",

  // Email
  "message/rfc822",

  // Web archives
  "application/x-mimearchive",
  "multipart/related",

  // XPS (Microsoft PDF alternative)
  "application/vnd.ms-xpsdocument",
  "application/oxps",
];

/**
 * MIME types that are not allowed for upload.
 * Comprehensive list for DocGather document processing.
 * @see docs/architecture/details/document-types-and-processing.md
 */
const MIME_TYPE_BLACKLIST = [
  // We don't allow emails to be uploaded (maybe in the future?)
  "message/rfc822",
  "application/vnd.ms-outlook",
];

/**
 * Detects MIME type from file content using structure inspection (magic bytes + central directory).
 * Falls back to filename extension if inspection fails.
 *
 * @param fileBytes - File content as Uint8Array
 * @param filename - Original filename (for fallback)
 * @param declaredMimeType - MIME type declared in upload (for fallback)
 * @returns Detection result with MIME type and extension
 */
export async function detectMimeType(
  fileBytes: Uint8Array,
  filename?: string,
  declaredMimeType?: string,
): Promise<MimeDetectionResult> {
  // Try structural detection first (supports Office Open XML vs ZIP distinction)
  const detected = await fileTypeFromBuffer(fileBytes);

  if (detected) {
    const mimeType = detected.mime || "application/octet-stream";
    const extension = detected.ext || mimeTypes.extension(mimeType) || "bin";

    // If file-type detects a generic ZIP, it might be a DOCX/XLSX without a full central directory
    // or a specialized ZIP format. In this case, if we have a filename with a more specific
    // Office extension, we should trust the filename extension over the generic "zip" detection.
    const isGenericZip = mimeType === "application/zip";

    if (isGenericZip && filename) {
      const ext = filename.split(".").pop()?.toLowerCase();
      if (ext) {
        const mimeFromExt = mimeTypes.lookup(ext);
        // Only override if the filename implies it's an Office document or other allowed complex type
        if (mimeFromExt && mimeFromExt !== "application/zip") {
          return {
            mimeType: mimeFromExt,
            extension: ext,
            fromMagicBytes: false,
          };
        }
      }
    }

    return { mimeType, extension, fromMagicBytes: true };
  }

  // Fallback to filename extension
  if (filename) {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext) {
      const mimeFromExt = mimeTypes.lookup(ext);
      if (mimeFromExt) {
        return { mimeType: mimeFromExt, extension: ext, fromMagicBytes: false };
      }
    }
  }

  // Fallback to declared MIME type
  if (declaredMimeType && declaredMimeType !== "application/octet-stream") {
    const ext = mimeTypes.extension(declaredMimeType) || "bin";
    return {
      mimeType: declaredMimeType,
      extension: ext,
      fromMagicBytes: false,
    };
  }

  // Ultimate fallback
  return {
    mimeType: "application/octet-stream",
    extension: "bin",
    fromMagicBytes: false,
  };
}

/**
 * Checks if a MIME type is allowed for upload.
 *
 * @param mimeType - MIME type to check
 * @returns true if allowed, false otherwise
 */
export function isAllowedMimeType(mimeType: string): boolean {
  return (
    !MIME_TYPE_BLACKLIST.includes(mimeType) &&
    ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))
  );
}

/**
 * Gets extension for a MIME type using mime-types library.
 *
 * @param mimeType - MIME type
 * @returns Extension without dot, or "bin" if unknown
 */
export function getExtensionForMime(mimeType: string): string {
  return mimeTypes.extension(mimeType) || "bin";
}
