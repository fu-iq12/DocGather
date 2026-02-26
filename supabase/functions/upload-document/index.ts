/**
 * Document Ingress Router (Edge Function)
 * Secures uploads, detects accurate MIME types, provisions vault keys, and initializes the processing state machine.
 *
 * @see architecture/documents-checklist.md - "Storage & Encryption"
 */

import {
  createServiceClient,
  createUserClient,
  getUserFromAuth,
} from "../_shared/supabase.ts";
import {
  detectMimeType,
  isAllowedMimeType,
} from "../_shared/mime-detection.ts";
import { isValidFileSize } from "../_shared/validation.ts";
import {
  bytesToHex,
  encryptFile,
  generateDEK,
  sha256,
} from "../_shared/crypto.ts";
import { buildDocumentPath } from "../_shared/storage.ts";
import {
  createHandler,
  jsonResponse,
  errorResponse,
} from "../_shared/middleware/index.ts";

/**
 * Source metadata for a document upload.
 * Tracked in document_private.encrypted_metadata.
 */
interface SourceMetadata {
  /** Source type: browser, api, cloud_import, etc. */
  source: string;
  /** Original file path (null for browser uploads) */
  filepath: string | null;
  /** Original filename of the document */
  original_filename: string | null;
  /** Original file creation date (null if unknown) */
  created_at: string | null;
  /** Original file modification date (null if unknown) */
  modified_at: string | null;
  /** When this upload occurred */
  uploaded_at: string;
}

/**
 * Encrypted metadata structure stored in document_private.
 * Keys are sha256(source + filepath) for dedup-safe merging.
 */
interface EncryptedMetadataPayload {
  sources: Record<string, SourceMetadata>;
}

interface UploadResponse {
  document_id: string;
  status: string;
  duplicate: boolean;
  source_added?: boolean; // true if source was added to existing doc
}

/**
 * Creates a unique key for a source based on source type and filepath.
 */
async function createSourceKey(
  source: string,
  filepath: string | null,
): Promise<string> {
  const input = `${source}:${filepath || ""}`;
  const hash = await sha256(new TextEncoder().encode(input));
  return bytesToHex(hash).slice(0, 16); // Use first 16 chars for brevity
}

console.info("upload-document function started");

const MASTER_KEY_VERSION = parseInt(
  Deno.env.get("SB_MASTER_KEY_VERSION") ?? "1",
);

createHandler(async (req: Request) => {
  // Only accept POST
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", "METHOD_NOT_ALLOWED", 405);
  }

  // Authenticate user
  const authHeader = req.headers.get("Authorization");
  const auth = await getUserFromAuth(authHeader);
  if (!auth) {
    return errorResponse("Unauthorized", "UNAUTHORIZED", 401);
  }
  const { userId } = auth;

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

  // Extract file
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return errorResponse("Missing file in request", "MISSING_FILE", 400);
  }

  // Validate file size
  if (!isValidFileSize(file.size)) {
    return errorResponse("File too large (max 50MB)", "FILE_TOO_LARGE", 413);
  }

  // Read file content
  const fileBuffer = await file.arrayBuffer();
  const fileBytes = new Uint8Array(fileBuffer);

  // Detect MIME type from content (magic bytes & deep inspection)
  const detection = await detectMimeType(fileBytes, file.name, file.type);
  const { mimeType, extension } = detection;

  // Validate MIME type
  if (!isAllowedMimeType(mimeType)) {
    return errorResponse(
      `File type not allowed: ${mimeType}`,
      "INVALID_MIME_TYPE",
      415,
    );
  }

  // Extract optional source metadata from form
  const sourceType = (formData.get("source") as string) || "browser";
  const filepath = formData.get("filepath") as string | null;
  const createdAt = formData.get("created_at") as string | null;
  const modifiedAt = formData.get("modified_at") as string | null;
  const uploadedAt = new Date().toISOString();

  // Build source metadata
  const sourceMetadata: SourceMetadata = {
    source: sourceType,
    filepath,
    original_filename: file.name,
    created_at: createdAt,
    modified_at: modifiedAt,
    uploaded_at: uploadedAt,
  };
  const sourceKey = await createSourceKey(sourceType, filepath);

  // Calculate content hash BEFORE encryption (for deduplication)
  const contentHash = await sha256(fileBytes);
  const contentHashHex = bytesToHex(contentHash);

  // Create service client for privileged operations
  const supabase = createServiceClient();

  // Check for duplicate file (same owner, same hash, role = 'original')
  const { data: existingFile } = await supabase
    .from("document_files")
    .select(
      `
      document_id,
      documents!inner (
        id,
        status,
        owner_id,
        deleted_at
      )
    `,
    )
    .eq("file_role", "original")
    .eq("content_hash", `\\x${contentHashHex}`)
    .eq("documents.owner_id", userId)
    .is("documents.deleted_at", null)
    .limit(1)
    .single();

  if (existingFile) {
    // Duplicate found - add this source to existing document's metadata
    const doc = existingFile.documents as unknown as {
      id: string;
      status: string;
    };

    // Fetch and decrypt existing metadata
    const { data: privateData } = await supabase
      .from("document_private")
      .select("encrypted_metadata, master_key_version")
      .eq("document_id", doc.id)
      .single();

    let existingMetadata: EncryptedMetadataPayload = { sources: {} };

    if (privateData?.encrypted_metadata) {
      // Decrypt existing metadata via RPC
      const { data: decryptedJson } = await supabase.rpc("decrypt_jsonb", {
        p_encrypted: privateData.encrypted_metadata,
        p_master_key_version: privateData.master_key_version,
      });
      if (decryptedJson) {
        existingMetadata = decryptedJson as EncryptedMetadataPayload;
      }
    }

    // Add new source (skip if exact same key already exists)
    const sourceAlreadyExists = sourceKey in (existingMetadata.sources || {});
    if (!sourceAlreadyExists) {
      existingMetadata.sources = existingMetadata.sources || {};
      existingMetadata.sources[sourceKey] = sourceMetadata;

      console.log(
        "existingMetadata",
        JSON.stringify(existingMetadata, null, 2),
      );

      // Encrypt updated metadata
      const { data: encryptedMeta } = await supabase.rpc("encrypt_jsonb", {
        p_data: existingMetadata,
        p_master_key_version: privateData?.master_key_version || 1,
      });

      if (encryptedMeta) {
        await supabase
          .from("document_private")
          .update({ encrypted_metadata: encryptedMeta })
          .eq("document_id", doc.id);
      }
    }

    return jsonResponse({
      document_id: doc.id,
      status: doc.status,
      duplicate: true,
      source_added: !sourceAlreadyExists,
    });
  }

  // New document - proceed with encryption and storage

  // Generate new document ID
  const documentId = crypto.randomUUID();

  // Generate DEK and encrypt file
  const dek = generateDEK();
  const { ciphertext, iv } = await encryptFile(fileBytes, dek);

  // Combine ciphertext and IV for storage (IV is prepended)
  const encryptedData = new Uint8Array(iv.length + ciphertext.length);
  encryptedData.set(iv, 0);
  encryptedData.set(ciphertext, iv.length);

  // Encrypt DEK using database function (calls Vault)
  const dekHex = `\\x${bytesToHex(dek)}`;
  const { data: encryptedDekResult, error: dekError } = await supabase.rpc(
    "encrypt_dek",
    { p_dek: dekHex, p_master_key_version: MASTER_KEY_VERSION },
  );

  if (dekError || !encryptedDekResult) {
    console.error("Failed to encrypt DEK:", dekError);
    return errorResponse("Internal encryption error", "ENCRYPTION_FAILED", 500);
  }

  // Build storage path
  const storagePath = buildDocumentPath(
    userId,
    documentId,
    "original",
    extension,
  );

  // Upload encrypted file to storage
  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, encryptedData, {
      contentType: "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    console.error("Failed to upload file:", uploadError);
    return errorResponse("Failed to store file", "STORAGE_FAILED", 500);
  }

  // Insert document record (document_type is NULL until processing)
  const { error: docError } = await supabase.from("documents").insert({
    id: documentId,
    owner_id: userId,
    document_type: null, // Determined during processing
    status: "queued",
  });

  if (docError) {
    console.error("Failed to insert document:", docError);
    await supabase.storage.from("documents").remove([storagePath]);
    throw docError;
  }

  // Insert document_files record
  const contentHashHexPg = `\\x${contentHashHex}`;
  const { error: fileError } = await supabase.from("document_files").insert({
    document_id: documentId,
    file_role: "original",
    storage_path: storagePath,
    mime_type: mimeType,
    file_size: file.size,
    content_hash: contentHashHexPg,
    encrypted_data_key: encryptedDekResult,
    master_key_version: MASTER_KEY_VERSION,
  });

  if (fileError) {
    console.error("Failed to insert document_files:", fileError);
    await supabase.from("documents").delete().eq("id", documentId);
    await supabase.storage.from("documents").remove([storagePath]);
    throw fileError;
  }

  // Create initial encrypted metadata with source info
  const initialMetadata: EncryptedMetadataPayload = {
    sources: { [sourceKey]: sourceMetadata },
  };

  // Encrypt metadata
  const { data: encryptedMeta, error: metaEncryptError } = await supabase.rpc(
    "encrypt_jsonb",
    { p_data: initialMetadata, p_master_key_version: MASTER_KEY_VERSION },
  );

  if (metaEncryptError) {
    console.error("Failed to encrypt metadata:", metaEncryptError);
  }

  // Insert document_private record with encrypted metadata
  const { error: privateError } = await supabase
    .from("document_private")
    .insert({
      document_id: documentId,
      encrypted_metadata: encryptedMeta || null,
      master_key_version: MASTER_KEY_VERSION,
    });

  if (privateError) {
    console.error("Failed to insert document_private:", privateError);
    await supabase.from("documents").delete().eq("id", documentId);
    await supabase.storage.from("documents").remove([storagePath]);
    throw privateError;
  }

  // Queue processing job (fire-and-forget)
  try {
    const supabase = createUserClient(authHeader!);
    const { error: queueError } = await supabase.functions.invoke("queue-job", {
      body: {
        document_id: documentId,
        source: "user_upload",
        original_filename: file.name,
      },
    });
    if (queueError) {
      const response = queueError.context as Response;
      if (response) {
        const body = await response.json();
        console.warn("Failed to queue job:", JSON.stringify(body, null, 2));
      } else {
        console.warn(
          "Failed to queue job:",
          JSON.stringify(queueError, null, 2),
        );
      }
    }
  } catch (err) {
    console.warn("Failed to invoke queue-job:", err);
  }

  return jsonResponse({
    document_id: documentId,
    status: "queued",
    duplicate: false,
  });
});
