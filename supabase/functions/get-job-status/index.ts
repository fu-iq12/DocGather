/**
 * get-job-status Edge Function
 * Returns the processing status of a document/job.
 */

import { createServiceClient, getUserFromAuth } from "../_shared/supabase.ts";
import {
  createHandler,
  jsonResponse,
  errorResponse,
} from "../_shared/middleware/index.ts";

interface StatusResponse {
  document_id: string;
  status: string;
  process_status: string | null;
  process_history: ProcessStep[];
}

interface ProcessStep {
  step: string;
  at: string;
  job_id?: string;
  error?: string;
}

console.info("get-job-status function started");

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
  const { userId } = auth;

  // Parse query params
  const url = new URL(req.url);
  const documentId = url.searchParams.get("document_id");

  if (!documentId) {
    return errorResponse("Missing document_id", "MISSING_DOCUMENT_ID", 400);
  }

  // Fetch document with ownership check
  const supabase = createServiceClient();
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("id, owner_id, status, process_status, process_history")
    .eq("id", documentId)
    .is("deleted_at", null)
    .single();

  if (docError || !doc) {
    return errorResponse("Document not found", "NOT_FOUND", 404);
  }

  if (doc.owner_id !== userId) {
    return errorResponse("Access denied", "FORBIDDEN", 403);
  }

  return jsonResponse({
    document_id: doc.id,
    status: doc.status,
    process_status: doc.process_status,
    process_history: (doc.process_history as ProcessStep[]) || [],
  });
});
