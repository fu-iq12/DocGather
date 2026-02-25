/**
 * storage-download Edge Function
 *
 * Decrypts and serves a document file for service-role callers (workers).
 * Auth: apikey header must match SB_SECRET_KEY.
 *
 * Query params:
 *   - document_id (required): UUID of the document
 *   - file_role (optional): file role to download (default: "original")
 */

import { createServiceClient } from "../_shared/supabase.ts";
import { base64ToBytes, decryptFile, hexToBytes } from "../_shared/crypto.ts";
import { errorResponse } from "../_shared/middleware/response.ts";
import { ServiceKeyMiddleware } from "../_shared/middleware/service-key-auth.ts";

console.info("storage-download function started");

Deno.serve((req) =>
  ServiceKeyMiddleware(req, async (req) => {
    try {
      // Only accept GET
      if (req.method !== "GET") {
        return errorResponse("Method not allowed", "METHOD_NOT_ALLOWED", 405);
      }

      // Parse query params
      const url = new URL(req.url);
      const documentId = url.searchParams.get("document_id");
      const fileRole = url.searchParams.get("file_role") || "original";

      if (!documentId) {
        return errorResponse("Missing document_id", "MISSING_DOCUMENT_ID", 400);
      }

      const supabase = createServiceClient();

      // Look up document_files record
      const { data: fileRecord, error: fileError } = await supabase
        .from("document_files")
        .select(
          "id, storage_path, mime_type, encrypted_data_key, master_key_version",
        )
        .eq("document_id", documentId)
        .eq("file_role", fileRole)
        .is("deleted_at", null)
        .single();

      if (fileError || !fileRecord) {
        return errorResponse(
          `File not found: ${documentId}/${fileRole}`,
          "NOT_FOUND",
          404,
        );
      }

      // Decrypt DEK via RPC
      const { data: dekString, error: dekError } = await supabase.rpc(
        "decrypt_dek",
        {
          p_encrypted_dek: fileRecord.encrypted_data_key,
          p_master_key_version: fileRecord.master_key_version,
        },
      );

      if (dekError) throw dekError;
      if (!dekString) {
        return errorResponse("DEK decryption failed", "DECRYPTION_FAILED", 500);
      }

      let dek: Uint8Array;
      if (dekString.startsWith("\\x")) {
        dek = hexToBytes(dekString);
      } else {
        dek = base64ToBytes(dekString);
      }

      // Download encrypted blob from storage
      const { data: encryptedBlob, error: storageError } =
        await supabase.storage
          .from("documents")
          .download(fileRecord.storage_path);

      if (storageError) throw storageError;
      if (!encryptedBlob) {
        return errorResponse(
          "File not found in storage",
          "FILE_NOT_FOUND",
          404,
        );
      }

      // Split IV (first 12 bytes) from ciphertext
      const encryptedData = new Uint8Array(await encryptedBlob.arrayBuffer());
      const iv = encryptedData.slice(0, 12);
      const ciphertext = encryptedData.slice(12);

      // Decrypt file
      let decryptedData: Uint8Array;
      try {
        decryptedData = await decryptFile(ciphertext, dek, iv);
      } catch (err) {
        console.error("Decryption error:", err);
        return errorResponse(
          "File decryption failed",
          "DECRYPTION_FAILED",
          500,
        );
      }

      // Return decrypted file
      return new Response(decryptedData as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": fileRecord.mime_type || "application/octet-stream",
          "Content-Length": decryptedData.length.toString(),
          "Cache-Control": "private, no-cache",
        },
      });
    } catch (err) {
      console.error("storage-download error:", err);
      const message =
        err instanceof Error ? err.message : "Internal server error";
      return errorResponse(message, "INTERNAL_ERROR", 500);
    }
  }),
);
