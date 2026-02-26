/**
 * Core BullMQ connection and queue topology.
 * Defines the centralized orchestrator queue and isolated worker queues
 * to ensure deterministic routing of subtasks across the distributed worker pool.
 *
 * @see architecture/processing-workers.md - "High-Level Architecture"
 */

import { Queue, QueueEvents } from "bullmq";
import { Redis } from "ioredis";

// Redis connection (shared across all queues and workers)
export const connection = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null, // Required for BullMQ
  enableReadyCheck: false,
});

connection.on("error", (err: Error) => {
  console.error("[Redis] Connection error:", err.message);
});

connection.on("connect", () => {
  console.log("[Redis] Connected");
});

// Queue for orchestrator jobs (parent jobs that spawn children)
export const orchestratorQueue = new Queue("orchestrator", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      age: 24 * 60 * 60, // Keep completed jobs for 24 hours
      count: 1000,
    },
    removeOnFail: {
      age: 7 * 24 * 60 * 60, // Keep failed jobs for 7 days
    },
  },
});

// Queue for task workers (child jobs: extract, classify, etc.)
// We use a separate queue for each worker to ensure correct routing
// (BullMQ distributes round-robin on shared queues, ignoring job names)

const TASK_QUEUE_NAMES = [
  "image-prefilter",
  "image-scaling",
  "llm-classify",
  "llm-normalize",
  "llm-ocr",
  "pdf-pre-analysis",
  "pdf-simple-extract",
  "txt-simple-extract",
  "pdf-splitter",
  "format-conversion",
] as const;

export type TaskQueueName = (typeof TASK_QUEUE_NAMES)[number];

const taskQueueOptions = {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 3000,
    },
    removeOnComplete: {
      age: 24 * 60 * 60,
      count: 5000,
    },
    removeOnFail: {
      age: 7 * 24 * 60 * 60,
    },
  },
};

// Create a map of queues
export const taskQueues = Object.fromEntries(
  TASK_QUEUE_NAMES.map((name) => [name, new Queue(name, taskQueueOptions)]),
) as Record<TaskQueueName, Queue>;

// Queue events for monitoring
export const orchestratorEvents = new QueueEvents("orchestrator", {
  connection,
});

export const taskQueueEvents = Object.fromEntries(
  TASK_QUEUE_NAMES.map((name) => [name, new QueueEvents(name, { connection })]),
) as Record<TaskQueueName, QueueEvents>;

// Graceful shutdown
export async function closeQueues(): Promise<void> {
  const taskQueueList = Object.values(taskQueues);
  const taskEventList = Object.values(taskQueueEvents);

  await Promise.all([
    orchestratorQueue.close(),
    ...taskQueueList.map((q) => q.close()),
    orchestratorEvents.close(),
    ...taskEventList.map((e) => e.close()),
    connection.quit(),
  ]);
  console.log("[Queues] Closed");
}
