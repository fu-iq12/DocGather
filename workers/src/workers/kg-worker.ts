import { Worker, Job } from "bullmq";
import { connection } from "../queues.js";
import { startObservation, propagateAttributes } from "@langfuse/tracing";
import { LangfuseClient } from "@langfuse/client";
import merge from "lodash.merge";
import { LLMClient, parseResponse } from "../llm/index.js";
import {
  getPendingKgDocuments,
  getKnowledgeGraph,
  ensureOwnerEntity,
  applyKgMutations,
  logKgBatchError,
  countPendingKgDocuments,
} from "../supabase.js";
import { kgMutationSchema } from "../llm/schemas/kg.js";
import { zodToTs } from "../llm/schemas/utils.js";

// Initialize the Langfuse client
const langfuse = new LangfuseClient();

/**
 * Worker for asynchronously synchronizing incoming documents into the Knowledge Graph.
 * This ensures that LLM patches to the graph are applied serially to prevent race conditions.
 */
export async function processKgBatch(job: Job) {
  const { ownerId, sessionId, jobTime } = job.data;
  if (!ownerId) throw new Error("Missing ownerId in job data");

  let span: any;
  return await propagateAttributes(
    {
      traceName: "kg-batch-process",
      sessionId: sessionId || `${jobTime || Date.now()}-${ownerId}-kg-batch`,
      userId: ownerId,
      tags: ["kg-worker"],
    },
    async () => {
      span = startObservation("kg-batch-process");
      try {
        const result = await _processKgBatch(job, span);
        span.end();
        return result;
      } catch (err) {
        span
          .update({
            level: "ERROR",
            statusMessage: String(err),
            metadata: { error: String(err) },
          })
          .end();
        throw err;
      }
    },
  );
}

async function _processKgBatch(job: Job, trace: any) {
  const { ownerId } = job.data;

  // 1. Fetch pending docs atomically (FOR UPDATE SKIP LOCKED)
  const batchSize = parseInt(process.env.KG_INGEST_BATCH_SIZE || "10");
  const docs = await getPendingKgDocuments(ownerId, batchSize);
  if (docs.length === 0) {
    console.log(
      `[KgWorker] No pending docs for ${ownerId} in batch ${job.id}. Skipping.`,
    );
    trace.update({ output: { skipped: true, reason: "no_pending_docs" } });
    return null;
  }

  const documentIds = docs.map((d) => d.document_id);
  trace.update({ input: { documentIds } });
  console.log(
    `[KgWorker] Processing ${docs.length} docs for ${ownerId} (batch ${job.id})`,
  );

  // 2. Orchestrator Batch Estimation Maintenance
  job.data.documentIds = (job.data.documentIds || []).filter(
    (id: string) => !documentIds.includes(id),
  );
  await job.updateData(job.data);

  try {
    // 3. Context Assembly
    await ensureOwnerEntity(ownerId);
    const currentGraph = await getKnowledgeGraph(ownerId);

    const newDocuments = docs.map((d) => ({
      document_id: d.document_id,
      document_type: d.document_type,
      document_date: d.document_date,
      extracted_data:
        d.extracted_data?.normalized || d.extracted_data?.classification,
    }));

    const context = {
      current_graph: currentGraph,
      new_documents: newDocuments,
    };

    const kgPrompt = await langfuse.prompt.get("kg");
    const systemPrompt = kgPrompt.compile({
      KgMutationResponse: zodToTs(kgMutationSchema, "KgMutationResponse"),
    });

    const userPrompt = JSON.stringify(context, null, 2);

    // 4. Request LLM Mutations
    const client = new LLMClient();
    const chatOptions = {
      responseFormat: { type: "json_object" as const },
      cachePrefix: "kg-worker",
      temperature: 0.1,
      parentTrace: trace,
      prompt: kgPrompt,
    };

    let response = await client.chat(systemPrompt, userPrompt, chatOptions);
    let parsed: any;

    const MAX_PARSE_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt++) {
      try {
        parsed = parseResponse(
          response.content,
          userPrompt,
          kgMutationSchema,
          trace,
        );
        break; // Success
      } catch (err) {
        if (attempt < MAX_PARSE_ATTEMPTS) {
          console.warn(
            `[KgWorker] Schema validation failed (attempt ${attempt}/${MAX_PARSE_ATTEMPTS}). Retrying LLM without cache.`,
            err,
          );
          response = await client.chat(systemPrompt, userPrompt, {
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

    // 4. Deep merge data from current graph and parsed mutations
    for (const entity of parsed.mutations.entities) {
      const existingEntity = currentGraph.entities.find(
        (e) => e.id === entity.id,
      );
      if (existingEntity) {
        existingEntity.data = merge({}, existingEntity.data, entity.data);
      }
    }
    for (const relationship of parsed.mutations.relationships) {
      const existingRelationship = currentGraph.relationships.find(
        (e) => e.id === relationship.id,
      );
      if (existingRelationship) {
        existingRelationship.data = merge(
          {},
          existingRelationship.data,
          relationship.data,
        );
      }
    }

    // 5. Apply DB Mutations ACID Transaction
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

    trace.update({ output: stats });

    // 6. Check for remaining work to instruct the event handler to re-queue
    const remainingCount = await countPendingKgDocuments(ownerId);
    return {
      ...stats,
      _requeue:
        remainingCount > 0
          ? { ownerId, documentIds: job.data.documentIds, remainingCount }
          : null,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[KgWorker] Batch error for ${ownerId}: ${errorMsg}`);
    await logKgBatchError(ownerId, documentIds, errorMsg);
    throw error;
  }
}

// Sequential processing per owner is guaranteed because the orchestrator uses a fixed `jobId` debounce key per owner.
export const kgWorker = new Worker("kg-ingestion", processKgBatch, {
  connection,
  concurrency: 5, // external service, high concurrency possible
});

kgWorker.on("completed", async (job, result) => {
  console.log(`[KgWorker] Job ${job.id} completed.`);

  if (result?._requeue) {
    try {
      const { ownerId, documentIds, remainingCount } = result._requeue;
      const batchSize = parseInt(process.env.KG_INGEST_BATCH_SIZE || "10");
      const delay =
        remainingCount >= batchSize
          ? 0
          : parseInt(process.env.KG_INGEST_DELAY_MS || "15000", 10);

      const { kgIngestionQueue } = await import("../queues.js");
      await kgIngestionQueue.add(
        "kg-ingest",
        { ownerId, documentIds, sessionId: job.data.sessionId },
        {
          jobId: `${ownerId}-kg-batch`,
          delay,
        },
      );
      console.log(
        `[KgWorker] Re-queued for ${ownerId} (${remainingCount} pending, delay=${delay}ms)`,
      );
    } catch (err) {
      console.error(
        `[KgWorker] Failed to re-queue job for ${result._requeue.ownerId}`,
        err,
      );
    }
  }
});
kgWorker.on("failed", (job, err) =>
  console.error(`[KgWorker] Job ${job?.id} failed:`, err.message),
);
