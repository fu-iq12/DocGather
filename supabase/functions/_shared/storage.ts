/**
 * Storage path utilities for Supabase Storage buckets.
 * Provides consistent path generation for documents and thumbnails.
 */

/**
 * Valid file roles for document files.
 * Maps to document_files.file_role column values.
 */
export type FileRole =
  | "original"
  | "converted_pdf"
  | "llm_optimized"
  | "extracted_text"
  | "redacted";

/**
 * Builds the storage path for a document file.
 *
 * Path structure: documents/{owner_id}/{document_id}/{role}.{ext}
 *
 * @param ownerId - User UUID who owns the document
 * @param documentId - Document UUID
 * @param role - File role (original, converted_pdf, etc.)
 * @param ext - File extension without dot (e.g., "pdf", "webp")
 * @returns Full storage path for the documents bucket
 *
 * @example
 * buildDocumentPath("abc-123", "doc-456", "original", "pdf")
 * // Returns: "abc-123/doc-456/original.pdf"
 */
export function buildDocumentPath(
  ownerId: string,
  documentId: string,
  role: FileRole,
  ext: string,
): string {
  // Validate inputs
  if (!ownerId || !documentId || !role || !ext) {
    throw new Error("All parameters are required for buildDocumentPath");
  }

  // Sanitize extension (remove leading dot if present)
  const cleanExt = ext.startsWith(".") ? ext.slice(1) : ext;

  return `${ownerId}/${documentId}/${role}.${cleanExt}`;
}

/**
 * Extracts the document ID from a storage path.
 *
 * @param path - Storage path (e.g., "abc-123/doc-456/original.pdf")
 * @returns Document ID or null if path is invalid
 */
export function extractDocumentIdFromPath(path: string): string | null {
  const parts = path.split("/");
  if (parts.length >= 2) {
    return parts[1];
  }
  return null;
}

/**
 * Extracts the owner ID from a storage path.
 *
 * @param path - Storage path (e.g., "abc-123/doc-456/original.pdf")
 * @returns Owner ID or null if path is invalid
 */
export function extractOwnerIdFromPath(path: string): string | null {
  const parts = path.split("/");
  if (parts.length >= 1) {
    return parts[0];
  }
  return null;
}

/**
 * Storage bucket names used in the application.
 */
export const BUCKETS = {
  /** Main documents bucket for encrypted files */
  DOCUMENTS: "documents",
} as const;
