/**
 * Supabase infrastructure client and state persistence layer.
 * Manages remote state synchronization, edge function RPC invocations for storage,
 * and handles cryptographic payload versioning via DEK master keys.
 *
 * @see architecture/documents-checklist.md - "Database Foundation & Storage"
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { ProcessingResults } from "./types.js";
import { cacheGet, cachePut } from "./file-cache.js";
import { SHARED_ZOD } from "./llm/schemas/document-types/index.js";
import z from "zod";
import { getDefaultConfig } from "./llm/types.js";

// Supabase client with service role key (full access)
export const supabase: SupabaseClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SB_SECRET_KEY!,
);

// ============================================================================
// Storage Operations (via encrypted edge functions)
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SB_SECRET_KEY = process.env.SB_SECRET_KEY!;

/**
 * Download and decrypt a file via the storage-download edge function.
 *
 * @param documentId - UUID of the document
 * @param fileRole - File role (e.g. "original", "scaled")
 * @returns Decrypted file content as ArrayBuffer
 */
export async function downloadFile(
  documentId: string,
  fileRole: string = "original",
): Promise<ArrayBuffer> {
  // Check cache first
  const cached = await cacheGet(documentId, fileRole);
  if (cached) {
    console.log(`[Storage] Cache HIT for ${documentId}/${fileRole}`);
    return cached;
  }

  const url = new URL(`${SUPABASE_URL}/functions/v1/storage-download`);
  url.searchParams.set("document_id", documentId);
  url.searchParams.set("file_role", fileRole);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      apikey: SB_SECRET_KEY,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to download ${documentId}/${fileRole}: ${response.status} ${body}`,
    );
  }

  const data = await response.arrayBuffer();

  // Populate cache
  await cachePut(documentId, fileRole, data);
  console.log(
    `[Storage] Cache MISS — downloaded & cached ${documentId}/${fileRole}`,
  );

  return data;
}

/**
 * Encrypt and upload a file via the storage-upload edge function.
 *
 * @param documentId - UUID of the document
 * @param fileRole - File role (e.g. "original", "scaled", "converted_pdf")
 * @param data - File content to upload
 * @param mimeType - MIME type of the file
 * @returns Upload result with storage_path and content_hash
 */
export async function uploadFile(
  documentId: string,
  fileRole: string,
  data: ArrayBuffer | Buffer,
  mimeType: string,
): Promise<{ storage_path: string; content_hash: string }> {
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([data], { type: mimeType }),
    `${fileRole}.bin`,
  );
  formData.append("document_id", documentId);
  formData.append("file_role", fileRole);
  formData.append("mime_type", mimeType);

  console.log(
    `[Storage] Uploading ${documentId}/${fileRole} (${data.byteLength} bytes) to ${SUPABASE_URL}/functions/v1/storage-upload`,
  );

  const response = await fetch(`${SUPABASE_URL}/functions/v1/storage-upload`, {
    method: "POST",
    headers: {
      apikey: SB_SECRET_KEY,
    },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to upload ${documentId}/${fileRole}: ${response.status} ${body}`,
    );
  }

  const result = (await response.json()) as {
    storage_path: string;
    content_hash: string;
  };

  // Cache the uploaded file so subsequent downloads are free
  await cachePut(
    documentId,
    fileRole,
    data instanceof Buffer ? data.buffer : data,
  );

  return result;
}

// ============================================================================
// Master Key Version Management
// ============================================================================

let cachedVaultMasterKeyVersion: number | null = null;
let cachedVaultMasterKeyVersionExpiresAt: number = 0;

/**
 * Get the master key version from the vault (cached for 5 minutes).
 */
async function getVaultMasterKeyVersion(): Promise<number> {
  const now = Date.now();
  if (
    cachedVaultMasterKeyVersion !== null &&
    now < cachedVaultMasterKeyVersionExpiresAt
  ) {
    return cachedVaultMasterKeyVersion;
  }

  const { data, error } = await supabase.rpc("get_vault_secret", {
    p_secret_name: "SB_MASTER_KEY_VERSION",
  });

  if (error || !data) {
    console.warn(
      `[Vault] Could not fetch SB_MASTER_KEY_VERSION, defaulting to 1. Error: ${error?.message}`,
    );
    cachedVaultMasterKeyVersion = 1;
  } else {
    cachedVaultMasterKeyVersion = parseInt(data, 10) || 1;
  }

  cachedVaultMasterKeyVersionExpiresAt = now + 5 * 60 * 1000; // 5 min TTL
  return cachedVaultMasterKeyVersion;
}

/**
 * Helper to determine which master_key_version to use.
 * Prefers the existing version on the row to avoid needing to re-encrypt data not being updated.
 */
async function getExistingOrVaultMasterKeyVersion(
  documentId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("document_private")
    .select("master_key_version")
    .eq("document_id", documentId)
    .maybeSingle();

  if (!error && data?.master_key_version) {
    return data.master_key_version;
  }

  return await getVaultMasterKeyVersion();
}

// ============================================================================
// Write-back Operations
// ============================================================================

/**
 * Safely parse and format a date string to YYYY-MM-DD.
 * Returns null if the date is invalid or incomplete.
 */
export function parseToISODate(dateStr?: string | null): string | null {
  if (!dateStr) return null;
  // Match YYYY-MM-DD
  const yyyyMmDdMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (yyyyMmDdMatch) {
    return dateStr.substring(0, 10);
  }
  // Match YYYY-MM
  const yyyyMmMatch = dateStr.match(/^(\d{4})-(\d{2})$/);
  if (yyyyMmMatch) {
    return `${dateStr}-01`;
  }
  // Match YYYY
  const yyyyMatch = dateStr.match(/^(\d{4})$/);
  if (yyyyMatch) {
    return `${dateStr}-01-01`;
  }
  return null;
}

/**
 * Intelligent extraction of document_date, valid_from, and valid_until based on various schemas.
 */
export function extractDatesFromNormalizedData(normalized?: any): {
  documentDate: string | null;
  validFrom: string | null;
  validUntil: string | null;
} {
  if (!normalized) {
    return { documentDate: null, validFrom: null, validUntil: null };
  }

  let documentDate: string | null = null;
  let validFrom: string | null = null;
  let validUntil: string | null = null;

  // 1. Look for period structures
  const period =
    normalized.period ||
    normalized.payPeriod ||
    normalized.bankStatementPeriod ||
    normalized.coveragePeriod ||
    normalized.probationPeriod;

  if (period) {
    if (period.startDate) validFrom = period.startDate;
    if (period.endDate) {
      validUntil = period.endDate;
      // If we have an end date for a period, it's usually a good proxy for the document/statement date
      documentDate = period.endDate;
    }
  }

  // 2. Specific single dates (override documentDate if found)
  if (normalized.billDate) documentDate = normalized.billDate;
  if (normalized.receiptDate) documentDate = normalized.receiptDate;

  // 3. Contract Start Date
  if (normalized.startDate) {
    validFrom = normalized.startDate;
    if (!documentDate) documentDate = normalized.startDate; // Fallback for document date
  }

  // 4. Inferred Periods (Academic / Fiscal Year)
  if (normalized.fiscalYear) {
    // Format is usually YYYY
    const yearMatch = String(normalized.fiscalYear).match(/^(\d{4})/);
    if (yearMatch) {
      const year = yearMatch[1];
      validFrom = `${year}-01-01`;
      validUntil = `${year}-12-31`;
    }
  }
  if (normalized.academicYear) {
    // Format is usually YYYY/YYYY
    const yearMatch = String(normalized.academicYear).match(/^(\d{4})/);
    if (yearMatch) {
      const year = yearMatch[1];
      validFrom = `${year}-09-01`;
      const nextYear = parseInt(year, 10) + 1;
      validUntil = `${nextYear}-08-31`;
    }
  }

  // 5. Default/Generic dates (dates.issueDate / expiryDate)
  if (normalized.dates) {
    if (normalized.dates.issueDate) {
      if (!documentDate) documentDate = normalized.dates.issueDate;
      if (!validFrom) validFrom = normalized.dates.issueDate;
    }
    if (normalized.dates.expiryDate && !validUntil) {
      validUntil = normalized.dates.expiryDate;
    }
  }

  // Validate and format
  return {
    documentDate: parseToISODate(documentDate),
    validFrom: parseToISODate(validFrom),
    validUntil: parseToISODate(validUntil),
  };
}

/**
 * Write processing results back to Supabase via RPC
 *
 * Called by the orchestrator after all child jobs complete.
 * Uses multiple RPC calls to update different tables.
 */
export async function writeBackResults(
  documentId: string,
  results: ProcessingResults,
  finalStatus: "processed" | "rejected" = "processed",
  details?: any,
): Promise<void> {
  const classification = results.classification;

  // Step 1: Update document table with classification
  if (classification) {
    // Extract dates using intelligent mapping
    const { documentDate, validFrom, validUntil } =
      extractDatesFromNormalizedData(results.normalized?.fields);

    const { error: docError } = await supabase.rpc("worker_update_document", {
      p_document_id: documentId,
      p_document_type: classification.documentType,
      p_status: "processed",
      p_process_status: "completed",
      p_extraction_confidence: classification.extractionConfidence,
      p_document_date: documentDate,
      p_valid_from: validFrom,
      p_valid_until: validUntil,
    });

    if (docError) {
      throw new Error(`worker_update_document failed: ${docError.message}`);
    }
  }

  // Step 2: Mark processing complete (updates history)
  const { error: completeError } = await supabase.rpc(
    "worker_mark_processing_complete",
    {
      p_document_id: documentId,
      p_final_status: finalStatus,
      p_details: details,
    },
  );

  if (completeError) {
    throw new Error(
      `worker_mark_processing_complete failed: ${completeError.message}`,
    );
  }

  // Step 3: Encrypt and store results in document_private
  // We encrypt the entire results object as per instructions
  await updateDocumentPrivate(documentId, { extractedData: results });

  if (process.env.FILE_CACHE_KEEP_ON_DISK === "true") {
    await import("fs/promises").then(async (fs) => {
      const config = getDefaultConfig();
      const uniqueModelDirs = [
        ...new Set([config.ocr.model, config.text.model, config.vision.model]),
      ];
      const dir = `/app/cache/results/${uniqueModelDirs.join("/")}`.replace(
        /[:]/g,
        "-",
      );
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        `${dir}/${documentId}.json`,
        JSON.stringify(results, null, 2),
      );
    });
  }

  console.log(`[WriteBack] Completed for document ${documentId}`);
}

/**
 * Mark a document as failed in Supabase
 */
export async function markDocumentFailed(
  documentId: string,
  errorMessage: string,
  workerVersion: string,
): Promise<void> {
  const { error } = await supabase.rpc("worker_mark_processing_complete", {
    p_document_id: documentId,
    p_final_status: "errored",
    p_error_message: `${errorMessage} (worker: ${workerVersion})`,
  });

  if (error) {
    console.error(
      `[WriteBack] Failed to mark document ${documentId} as failed:`,
      error.message,
    );
  }
}

/**
 * Log a granular processing step asynchronously so the UI and state can reflect real-time progress.
 */
export async function logProcessStep(
  documentId: string,
  processStatus: string,
  details?: any,
): Promise<void> {
  const { error } = await supabase.rpc("worker_log_process_step", {
    p_document_id: documentId,
    p_new_process_status: processStatus,
    p_step_details: details,
  });

  if (error) {
    console.error(
      `[WriteBack] Failed to log step status ${processStatus} for document ${documentId}:`,
      error.message,
    );
  }
}

/**
 * Update private document data (encrypted extracted data and/or metadata)
 */
export async function updateDocumentPrivate(
  documentId: string,
  options: {
    extractedData?: any;
    metadata?: any;
  },
): Promise<void> {
  // Determine which master_key_version to use (preserve existing if possible)
  const masterKeyVersion = await getExistingOrVaultMasterKeyVersion(documentId);

  let encryptedExtractedData = null;
  let encryptedMetadata = null;

  if (options.extractedData) {
    const { data: encrypted, error: encryptError } = await supabase.rpc(
      "encrypt_jsonb",
      {
        p_data: options.extractedData,
        p_master_key_version: masterKeyVersion,
      },
    );

    if (encryptError) {
      console.error(
        `[WriteBack] encrypt_jsonb failed for extractedData of document ${documentId}:`,
        encryptError.message,
      );
    } else {
      encryptedExtractedData = encrypted;
    }
  }

  if (options.metadata) {
    const { data: encrypted, error: encryptError } = await supabase.rpc(
      "encrypt_jsonb",
      {
        p_data: options.metadata,
        p_master_key_version: masterKeyVersion,
      },
    );

    if (encryptError) {
      console.error(
        `[WriteBack] encrypt_jsonb failed for metadata of document ${documentId}:`,
        encryptError.message,
      );
    } else {
      encryptedMetadata = encrypted;
    }
  }

  const { error } = await supabase.rpc("worker_update_document_private", {
    p_document_id: documentId,
    p_encrypted_extracted_data: encryptedExtractedData,
    p_encrypted_metadata: encryptedMetadata,
    p_master_key_version: masterKeyVersion,
  });

  if (error) {
    console.error(
      `[WriteBack] Failed to update document_private for ${documentId}:`,
      error.message,
    );
  }
}

/**
 * Create a child document (for PDF splitting)
 *
 * Uses the worker_create_child_document RPC to insert a new document
 * linked to its parent, with page range lineage metadata.
 */
export async function createChildDocument(
  parentDocumentId: string,
  ownerId: string,
  pageRange: any, // JSONB structure { pages: number[], type: string }
  typeHint: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("worker_create_child_document", {
    p_parent_document_id: parentDocumentId,
    p_owner_id: ownerId,
    p_page_range: pageRange,
    p_type_hint: typeHint,
  });

  if (error) {
    throw new Error(`worker_create_child_document failed: ${error.message}`);
  }

  // Returns the new child document ID
  return data as string;
}

// ============================================================================
// Document File Operations
// ============================================================================

/**
 * Create or update a document file record
 */
export async function createDocumentFile(
  documentId: string,
  fileRole: string,
  storagePath: string,
  mimeType: string,
  fileSize: number,
  contentHash: Uint8Array,
  encryptedDataKey: Uint8Array,
  options?: {
    masterKeyVersion?: number;
    width?: number;
    height?: number;
    pageCount?: number;
  },
): Promise<string> {
  const { data, error } = await supabase.rpc("worker_update_document_file", {
    p_document_id: documentId,
    p_file_role: fileRole,
    p_storage_path: storagePath,
    p_mime_type: mimeType,
    p_file_size: fileSize,
    p_content_hash: contentHash,
    p_encrypted_data_key: encryptedDataKey,
    p_master_key_version: options?.masterKeyVersion ?? 1,
    p_width: options?.width ?? null,
    p_height: options?.height ?? null,
    p_page_count: options?.pageCount ?? null,
  });

  if (error) {
    throw new Error(`worker_update_document_file failed: ${error.message}`);
  }

  return data as string;
}
