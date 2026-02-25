/**
 * queue-job Edge Function
 * Adds document processing jobs to BullMQ via Fly.io worker.
 *
 * Called after successful upload to trigger async processing.
 */

import { createServiceClient, getUserFromAuth } from "../_shared/supabase.ts";
import {
  createHandler,
  jsonResponse,
  errorResponse,
} from "../_shared/middleware/index.ts";

interface JobRequest {
  document_id: string;
  job_type?: "full" | "summary_only";
  /** Source of the job for priority calculation */
  source?: "user_upload" | "cloud_sync" | "retry";
  original_filename?: string;
}

interface JobResponse {
  job_id: string;
  document_id: string;
  status: "queued";
  priority: number;
  estimated_wait_seconds?: number;
}

console.info("queue-job function started");

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

  // Parse request body
  let body: JobRequest;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", "INVALID_BODY", 400);
  }

  const {
    document_id,
    job_type: _job_type = "full",
    source = "user_upload",
    original_filename,
  } = body;

  if (!document_id) {
    return errorResponse("Missing document_id", "MISSING_DOCUMENT_ID", 400);
  }

  // Get priority based on source
  const supabase = createServiceClient();
  const { data: priority, error: priorityError } = await supabase.rpc(
    "get_job_priority",
    { p_source: source },
  );
  if (priorityError) {
    console.error("Failed to get priority:", priorityError);
    // Default to medium priority on error
  }
  const jobPriority = priority ?? 5;

  // Verify document exists and belongs to user
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("id, owner_id, status, process_history")
    .eq("id", document_id)
    .is("deleted_at", null)
    .single();

  if (docError || !doc) {
    return errorResponse("Document not found", "NOT_FOUND", 404);
  }

  if (doc.owner_id !== userId) {
    return errorResponse("Access denied", "FORBIDDEN", 403);
  }

  // Check if document is already processed or processing
  if (doc.status === "processed") {
    return errorResponse(
      "Document already processed",
      "ALREADY_PROCESSED",
      409,
    );
  }

  if (doc.status === "processing") {
    return errorResponse(
      "Document is currently being processed",
      "ALREADY_PROCESSING",
      409,
    );
  }

  // Get Fly.io worker URL from environment
  const workerUrl = Deno.env.get("FLY_WORKER_URL");
  if (!workerUrl) {
    console.error("FLY_WORKER_URL not configured");
    return errorResponse(
      "Worker service unavailable",
      "SERVICE_UNAVAILABLE",
      503,
    );
  }

  // Get worker API key for authentication (optional for local, required for Fly)
  const workerApiKey = Deno.env.get("FLY_WORKER_API_KEY");

  // Fetch file info needed for the worker's /queue endpoint
  const { data: fileData, error: fileError } = await supabase
    .from("document_files")
    .select("id, storage_path, mime_type")
    .eq("document_id", document_id)
    .eq("file_role", "original")
    .limit(1)
    .single();

  if (fileError || !fileData) {
    console.error("Could not find original file:", fileError);
    return errorResponse("Original file not found", "FILE_NOT_FOUND", 404);
  }

  // Prepare payload for worker's /queue endpoint
  // See workers/src/index.ts: QueueJobRequest
  const workerPayload = {
    documentId: document_id,
    ownerId: userId,
    mimeType: fileData.mime_type,
    originalFileId: fileData.id,
    originalPath: fileData.storage_path,
    source,
    priority: jobPriority,
    originalFilename: original_filename,
  };

  let queueSuccess = true;
  let queueError = "";
  let jobId = "";

  try {
    // Determine endpoint based on URL structure or just append /queue?
    // The user said "local /queue api call".
    // If workerUrl is "http://host.docker.internal:8080", we append "/queue".
    // Note: The previous code used "/api/jobs", but the local worker has "/queue".
    // We will use "/queue" as the standard now.

    // Normalize URL
    const baseUrl = workerUrl.replace(/\/$/, "");
    const endpoint = `${baseUrl}/queue`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (workerApiKey) {
      headers["Authorization"] = `Bearer ${workerApiKey}`;
    }

    const workerResponse = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(workerPayload),
    });

    if (!workerResponse.ok) {
      queueError = await workerResponse.text();
      console.error(`Worker returned ${workerResponse.status}: ${queueError}`);
      queueSuccess = false;
    } else {
      const responseData = await workerResponse.json();
      jobId = responseData.jobId;
    }
  } catch (err) {
    console.error("Failed to notify worker:", err);
    queueError = err instanceof Error ? err.message : "Unknown error";
    queueSuccess = false;
  }

  // Now update document based on queue result
  const now = new Date().toISOString();
  const existingHistory =
    (doc.process_history as Record<string, unknown>[]) || [];

  if (queueSuccess) {
    // Append to process_history and update status
    const newHistory = [
      ...existingHistory,
      { step: "queued", at: now, job_id: jobId },
    ];
    const { error: updateError } = await supabase
      .from("documents")
      .update({
        status: "queued",
        process_status: "pending",
        process_history: newHistory,
        priority_score: jobPriority,
      })
      .eq("id", document_id);

    if (updateError) throw updateError;

    return jsonResponse({
      job_id: jobId,
      document_id,
      status: "queued",
      priority: jobPriority,
    });
  } else {
    // Append error to process_history and set errored status
    const newHistory = [
      ...existingHistory,
      {
        step: "queue_failed",
        at: now,
        job_id: "",
        error: queueError || "Worker notification failed",
      },
    ];
    const { error: updateError } = await supabase
      .from("documents")
      .update({
        process_status: "errored",
        process_history: newHistory,
      })
      .eq("id", document_id);

    if (updateError) throw updateError;

    return errorResponse("Failed to queue job", "QUEUE_FAILED", 503);
  }
});
