/**
 * Secure Document Retrieval (Edge Function)
 * Streams decrypted payloads from Vault-backed storage, tracking access telemetry.
 *
 * @see architecture/documents-checklist.md - "Data Egress & Access"
 */

import {
  createServiceClient,
  createUserClient,
  getUserFromAuth,
} from "../_shared/supabase.ts";
import {
  base64ToBytes,
  decryptFile,
  sha256,
  bytesToHex,
  hexToBytes,
} from "../_shared/crypto.ts";
import { createHandler, errorResponse } from "../_shared/middleware/index.ts";

/**
 * Hash an access identifier (IP or User-Agent) for privacy.
 */
async function hashAccessInfo(value: string | null): Promise<string | null> {
  if (!value) return null;
  const bytes = new TextEncoder().encode(value);
  const hash = await sha256(bytes);
  return bytesToHex(hash);
}

console.info("get-document function started");

createHandler(async (req: Request) => {
  // Only accept GET
  if (req.method !== "GET") {
    return errorResponse("Method not allowed", "METHOD_NOT_ALLOWED", 405);
  }

  // Authenticate user
  const authHeader = req.headers.get("Authorization");
  const auth = await getUserFromAuth(authHeader);
  if (!auth) {
    return errorResponse("Unauthorized", "UNAUTHORIZED", 401);
  }
  const { userId, jwt } = auth;

  // Parse query params
  const url = new URL(req.url);
  const documentId = url.searchParams.get("document_id");
  const fileRole = url.searchParams.get("file_role") || "original";

  if (!documentId) {
    return errorResponse("Missing document_id", "MISSING_DOCUMENT_ID", 400);
  }

  // Use user client for RLS-protected queries
  const userClient = createUserClient(jwt);
  const serviceClient = createServiceClient();

  // Fetch document file record (RLS enforces ownership)
  const { data: fileRecord, error: fileError } = await userClient
    .from("document_files")
    .select(
      `
      id,
      document_id,
      storage_path,
      mime_type,
      encrypted_data_key,
      master_key_version,
      documents!inner (
        id,
        owner_id,
        deleted_at
      )
    `,
    )
    .eq("document_id", documentId)
    .eq("file_role", fileRole)
    .is("documents.deleted_at", null)
    .single();

  if (fileError || !fileRecord) {
    // RLS will hide documents from other users, so 404 is appropriate
    return errorResponse("Document not found", "NOT_FOUND", 404);
  }

  // Decrypt DEK using database function
  const { data: dekString, error: dekError } = await serviceClient.rpc(
    "decrypt_dek",
    {
      p_encrypted_dek: fileRecord.encrypted_data_key,
      p_master_key_version: fileRecord.master_key_version,
    },
  );

  if (dekError) throw dekError;
  if (!dekString) {
    return errorResponse("Decryption failed", "DECRYPTION_FAILED", 500);
  }

  // Convert DEK from hex (Postgres bytea) or base64 to bytes
  let dek: Uint8Array;
  if (dekString.startsWith("\\x")) {
    dek = hexToBytes(dekString);
  } else {
    dek = base64ToBytes(dekString);
  }

  // Fetch encrypted file from storage
  const { data: encryptedBlob, error: storageError } =
    await serviceClient.storage
      .from("documents")
      .download(fileRecord.storage_path);

  if (storageError) throw storageError;
  if (!encryptedBlob) {
    return errorResponse("File not found", "FILE_NOT_FOUND", 404);
  }

  // Parse encrypted data: first 12 bytes = IV, rest = ciphertext
  const encryptedData = new Uint8Array(await encryptedBlob.arrayBuffer());
  const iv = encryptedData.slice(0, 12);
  const ciphertext = encryptedData.slice(12);

  // Decrypt file
  let decryptedData: Uint8Array;
  try {
    decryptedData = await decryptFile(ciphertext, dek, iv);
  } catch (err) {
    console.error("Decryption error:", err);
    return errorResponse("Decryption failed", "DECRYPTION_FAILED", 500);
  }

  // Log access (async, don't wait)
  const ipHash = await hashAccessInfo(
    req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip"),
  );
  const uaHash = await hashAccessInfo(req.headers.get("user-agent"));

  serviceClient
    .from("document_access_log")
    .insert({
      document_id: documentId,
      user_id: userId,
      action: "download",
      ip_hash: ipHash,
      user_agent_hash: uaHash,
    })
    .then(({ error }) => {
      if (error) console.error("Failed to log access:", error);
    });

  // Build filename for Content-Disposition
  const ext = fileRecord.storage_path.split(".").pop() || "bin";
  const filename = `${documentId}.${ext}`;

  // Return decrypted file
  return new Response(decryptedData as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": fileRecord.mime_type || "application/octet-stream",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Content-Length": decryptedData.length.toString(),
      "Cache-Control": "private, no-cache",
    },
  });
});
