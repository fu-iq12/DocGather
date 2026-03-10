import { Worker, Job } from "bullmq";
import { connection } from "../queues.js";
import { LLMClient } from "../llm/index.js";
import {
  getPendingKgDocuments,
  getKnowledgeGraph,
  ensureOwnerEntity,
  applyKgMutations,
  logKgBatchError,
} from "../supabase.js";
import { kgMutationSchema } from "../llm/schemas/kg.js";
import { KG_SYSTEM_PROMPT } from "../llm/prompts/kg.js";

/**
 * Worker for asynchronously synchronizing incoming documents into the Knowledge Graph.
 * This ensures that LLM patches to the graph are applied serially to prevent race conditions.
 */
export async function processKgBatch(job: Job) {
  const { ownerId } = job.data;
  if (!ownerId) throw new Error("Missing ownerId in job data");

  // 1. Fetch pending docs atomically (FOR UPDATE SKIP LOCKED)
  const batchSize = parseInt(process.env.KG_INGEST_BATCH_SIZE || "10");
  const docs = await getPendingKgDocuments(ownerId, batchSize);
  if (docs.length === 0) {
    console.log(
      `[KgWorker] No pending docs for ${ownerId} in batch ${job.id}. Skipping.`,
    );
    return null;
  }

  const documentIds = docs.map((d) => d.document_id);
  console.log(
    `[KgWorker] Processing ${docs.length} docs for ${ownerId} (batch ${job.id})`,
  );

  try {
    // 2. Context Assembly
    await ensureOwnerEntity(ownerId);
    const currentGraph = await getKnowledgeGraph(ownerId);

    // Minimal subset of newly extracted docs to fit smoothly in context
    const newDocuments = docs.map((d) => ({
      document_id: d.document_id,
      document_type: d.document_type,
      document_date: d.document_date,
      extracted_data: d.extracted_data,
    }));

    const context = {
      current_graph: currentGraph,
      new_documents: newDocuments,
    };

    const promptText = `CONTEXT:\n${JSON.stringify(context, null, 2)}`;

    // 3. Request LLM Mutations
    const client = new LLMClient();
    const chatOptions = {
      responseFormat: { type: "json_object" as const },
      cachePrefix: "kg-worker",
      temperature: 0,
    };

    let response = await client.chat(KG_SYSTEM_PROMPT, promptText, chatOptions);
    let parsed: any;

    const MAX_PARSE_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt++) {
      try {
        const jsonMatch = response.content.match(
          /```(?:json|typescript)?\s*([\s\S]*?)```/,
        );
        const jsonStr = jsonMatch
          ? jsonMatch[1].trim()
          : response.content.trim();
        const rawJson = JSON.parse(jsonStr);

        // Ensure schema compliance. If invalid, throws ZodError.
        parsed = kgMutationSchema.parse(rawJson);
        break; // Success
      } catch (err) {
        if (attempt < MAX_PARSE_ATTEMPTS) {
          console.warn(
            `[KgWorker] Schema validation failed (attempt ${attempt}/${MAX_PARSE_ATTEMPTS}). Retrying LLM without cache.`,
            err,
          );
          response = await client.chat(KG_SYSTEM_PROMPT, promptText, {
            ...chatOptions,
            skipCache: true,
          });
        } else {
          throw new Error(
            `LLM output validation failed after ${MAX_PARSE_ATTEMPTS} attempts: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    }

    // 4. Apply DB Mutations ACID Transaction
    // Use parsed.mutations and parsed.attributions directly
    const stats = await applyKgMutations(
      ownerId,
      parsed.mutations,
      parsed.attributions,
      documentIds,
      response,
    );
    console.log(
      `[KgWorker] Successfully mapped batch ${job.id} for ${ownerId}. Stats: ${JSON.stringify(stats)}`,
    );

    return stats;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[KgWorker] Batch error for ${ownerId}: ${errorMsg}`);

    // Fallback error-handling: revert DB entities back to "pending"
    await logKgBatchError(ownerId, documentIds, errorMsg);
    throw error;
  }
}

// Sequential processing per owner is guaranteed because the orchestrator uses a fixed `jobId` debounce key per owner.
export const kgWorker = new Worker("kg-ingestion", processKgBatch, {
  connection,
  concurrency: 5, // external service, high concurrency possible
});

kgWorker.on("completed", (job) =>
  console.log(`[KgWorker] Job ${job.id} completed.`),
);
kgWorker.on("failed", (job, err) =>
  console.error(`[KgWorker] Job ${job?.id} failed:`, err.message),
);
