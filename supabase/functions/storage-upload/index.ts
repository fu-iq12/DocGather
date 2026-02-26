/**
 * Internal Storage Ingress (Edge Function)
 * Privileged endpoint allowing workers to encrypt and persist intermediate document objects into Vault.
 *
 * @see architecture/documents-checklist.md - "Storage & Encryption"
 */

import { createServiceClient } from "../_shared/supabase.ts";
import {
  bytesToHex,
  encryptFile,
  generateDEK,
  sha256,
} from "../_shared/crypto.ts";
import { buildDocumentPath, type FileRole } from "../_shared/storage.ts";
import { jsonResponse, errorResponse } from "../_shared/middleware/response.ts";
import { ServiceKeyMiddleware } from "../_shared/middleware/service-key-auth.ts";

console.info("storage-upload function started");

const MASTER_KEY_VERSION = parseInt(
  Deno.env.get("SB_MASTER_KEY_VERSION") ?? "1",
);

Deno.serve((req) =>
  ServiceKeyMiddleware(req, async (req) => {
    try {
      // Only accept POST
      if (req.method !== "POST") {
        return errorResponse("Method not allowed", "METHOD_NOT_ALLOWED", 405);
      }

      // Parse multipart form data
      let formData: FormData;
      try {
        formData = await req.formData();
      } catch {
        return errorResponse(
          "Invalid multipart form data",
          "INVALID_FORM_DATA",
          400,
        );
      }

      // Extract required fields
      const file = formData.get("file");
      if (!file || !(file instanceof File)) {
        return errorResponse("Missing file in request", "MISSING_FILE", 400);
      }

      const documentId = formData.get("document_id") as string | null;
      if (!documentId) {
        return errorResponse("Missing document_id", "MISSING_DOCUMENT_ID", 400);
      }

      const fileRole = formData.get("file_role") as string | null;
      if (!fileRole) {
        return errorResponse("Missing file_role", "MISSING_FILE_ROLE", 400);
      }

      const mimeType =
        (formData.get("mime_type") as string | null) ||
        file.type ||
        "application/octet-stream";

      const supabase = createServiceClient();

      // Look up document to get owner_id
      const { data: doc, error: docError } = await supabase
        .from("documents")
        .select("owner_id")
        .eq("id", documentId)
        .single();

      if (docError || !doc) {
        return errorResponse(
          `Document not found: ${documentId}`,
          "DOCUMENT_NOT_FOUND",
          404,
        );
      }

      // Read file content
      const fileBuffer = await file.arrayBuffer();
      const fileBytes = new Uint8Array(fileBuffer);

      // Compute content hash BEFORE encryption
      const contentHash = await sha256(fileBytes);
      const contentHashHex = bytesToHex(contentHash);

      // Generate DEK and encrypt file
      const dek = generateDEK();
      const { ciphertext, iv } = await encryptFile(fileBytes, dek);

      // Combine IV + ciphertext for storage
      const encryptedData = new Uint8Array(iv.length + ciphertext.length);
      encryptedData.set(iv, 0);
      encryptedData.set(ciphertext, iv.length);

      // Encrypt DEK via RPC
      const dekHex = `\\x${bytesToHex(dek)}`;
      const { data: encryptedDekResult, error: dekError } = await supabase.rpc(
        "encrypt_dek",
        { p_dek: dekHex, p_master_key_version: MASTER_KEY_VERSION },
      );

      if (dekError || !encryptedDekResult) {
        console.error("Failed to encrypt DEK:", dekError);
        return errorResponse(
          "Internal encryption error",
          "ENCRYPTION_FAILED",
          500,
        );
      }

      // Determine extension from mime type or file name
      const ext = getExtensionForMime(mimeType, file.name);

      // Build storage path
      const storagePath = buildDocumentPath(
        doc.owner_id,
        documentId,
        fileRole as FileRole,
        ext,
      );

      // Upload encrypted file to storage
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(storagePath, encryptedData, {
          contentType: "application/octet-stream",
          upsert: true,
        });

      if (uploadError) {
        console.error("Failed to upload file:", uploadError);
        return errorResponse("Failed to store file", "STORAGE_FAILED", 500);
      }

      // Upsert document_files record
      const contentHashHexPg = `\\x${contentHashHex}`;
      const { error: fileError } = await supabase.from("document_files").upsert(
        {
          document_id: documentId,
          file_role: fileRole,
          storage_path: storagePath,
          mime_type: mimeType,
          file_size: file.size,
          content_hash: contentHashHexPg,
          encrypted_data_key: encryptedDekResult,
          master_key_version: MASTER_KEY_VERSION,
        },
        { onConflict: "document_id,file_role" },
      );

      if (fileError) {
        console.error("Failed to upsert document_files:", fileError);
        // Cleanup uploaded blob on failure
        await supabase.storage.from("documents").remove([storagePath]);
        return errorResponse("Failed to create file record", "DB_ERROR", 500);
      }

      return jsonResponse({
        storage_path: storagePath,
        content_hash: contentHashHex,
        file_size: file.size,
        encrypted: true,
      });
    } catch (err) {
      console.error("storage-upload error:", err);
      const message =
        err instanceof Error ? err.message : "Internal server error";
      return errorResponse(message, "INTERNAL_ERROR", 500);
    }
  }),
);

/**
 * Derives file extension from MIME type or filename.
 */
function getExtensionForMime(mimeType: string, fileName?: string): string {
  // Try to get from filename first
  if (fileName) {
    const ext = fileName.split(".").pop();
    if (ext && ext.length <= 5) return ext;
  }

  // Common MIME → extension mappings
  const mimeMap: Record<string, string> = {
    "application/pdf": "pdf",
    "image/webp": "webp",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/heic": "heic",
    "image/tiff": "tiff",
    "text/plain": "txt",
    "application/json": "json",
  };

  return mimeMap[mimeType] || "bin";
}
