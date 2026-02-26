import { Job, Queue, Worker } from "bullmq";
import { listFiles, deleteFile } from "../llm/providers/mistral-files.js";
import { connection } from "../queues.js";

/**
 * Worker that lists files on Mistral and deletes any 'document-{uuid}' prefixed files
 * that are older than 30 minutes.
 */
async function processMistralCleanup(
  job: Job,
): Promise<{ deleted: number; shouldReschedule?: boolean }> {
  console.log(`[MistralCleanup] Starting cleanup job ${job.id}`);

  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    console.warn(`[MistralCleanup] No MISTRAL_API_KEY found, skipping cleanup`);
    return { deleted: 0 };
  }

  try {
    // List files restricted to "ocr" purpose
    const files = await listFiles(apiKey, "ocr");

    // Mistral returns created_at as unix timestamp in seconds
    const thirtyMinAgo = Date.now() / 1000 - 1800;

    let deleted = 0;
    let hasYoungFiles = false;

    for (const file of files) {
      if (!file.filename.match(/^document-\w{8}-\w{4}-\w{4}-\w{4}-\w{12}/)) {
        continue;
      }

      if (file.created_at < thirtyMinAgo) {
        try {
          await deleteFile(apiKey, file.id);
          console.log(
            `[MistralCleanup] Deleted stale file ${file.filename} (${file.id})`,
          );
          deleted++;
        } catch (delErr) {
          console.error(
            `[MistralCleanup] Failed to delete ${file.id}:`,
            delErr,
          );
        }
      } else {
        hasYoungFiles = true;
      }
    }

    console.log(`[MistralCleanup] Finished cleanup. Deleted ${deleted} files.`);

    // If there are still recent docgather files, reschedule to check again later
    if (hasYoungFiles) {
      return { deleted, shouldReschedule: true };
    }

    return { deleted };
  } catch (err) {
    console.error(`[MistralCleanup] Failed to run cleanup`, err);
    throw err;
  }
}

/**
 * Mistral cleanup worker
 */
export const mistralCleanupWorker = new Worker(
  "mistral-cleanup",
  async (job) => {
    try {
      return await processMistralCleanup(job);
    } catch (err: any) {
      throw new Error(err.message || "Mistral cleanup failed");
    }
  },
  { connection, concurrency: 1 },
);

mistralCleanupWorker.on("completed", async (job, result) => {
  if (result.shouldReschedule) {
    const cleanupQueue = new Queue("mistral-cleanup", { connection });
    await cleanupQueue.add(
      "cleanup",
      {},
      {
        jobId: job.id,
        delay: 30 * 60 * 1000, // 30 minutes
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    console.log(
      `[MistralCleanup] Young files remain, rescheduled followup for 30 mins`,
    );
  } else {
    console.log(`[MistralCleanup] Job ${job.id} completed`);
  }
});

mistralCleanupWorker.on("failed", (job, error) => {
  console.error(`[MistralCleanup] Job ${job?.id} failed:`, error.message);
});

export { processMistralCleanup };
