/**
 * Worker Entry Point
 *
 * HTTP server for health checks and waker endpoint.
 * Starts all worker processes.
 */

import express, { Request, Response } from "express";
import {
  orchestratorWorker,
  queueDocumentForProcessing,
} from "./orchestrator.js";
import { imageScalingWorker } from "./workers/image-scaling.js";
import { imagePrefilterWorker } from "./workers/image-prefilter.js";
import { llmClassifyWorker } from "./workers/llm-classify.js";
import { llmNormalizeWorker } from "./workers/llm-normalize.js";
import { llmOcrWorker } from "./workers/llm-ocr.js";
import { pdfPreAnalysisWorker } from "./workers/pdf-pre-analysis.js";
import { pdfSimpleExtractWorker } from "./workers/pdf-simple-extract.js";
import { pdfSplitterWorker } from "./workers/pdf-splitter.js";
import { txtSimpleExtractWorker } from "./workers/txt-simple-extract.js";
import { formatConversionWorker } from "./workers/format-conversion.js";
import { closeQueues } from "./queues.js";
import { clearStaleCacheEntries } from "./file-cache.js";
import type { JobSource } from "./types.js";
import { getDefaultConfig } from "./llm/types.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const WORKER_VERSION = process.env.FLY_MACHINE_VERSION || "local-dev";

// ============================================================================
// Health & Status Endpoints
// ============================================================================

/**
 * Health check endpoint
 *
 * Returns worker version and status for monitoring and retry logic.
 */
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    version: WORKER_VERSION,
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

/**
 * Wake endpoint
 *
 * Called to wake up Fly.io machine from scaled-to-zero state.
 * Simply returns immediately to confirm the worker is awake.
 */
app.post("/wake", (_req: Request, res: Response) => {
  console.log("[Waker] Worker awakened");
  res.json({
    status: "awake",
    version: WORKER_VERSION,
  });
});

// ============================================================================
// Job Queue Endpoint
// ============================================================================

interface QueueJobRequest {
  documentId: string;
  ownerId: string;
  /** MIME type from document_files (detected via magic bytes at upload) */
  mimeType: string;
  /** ID of the original file in document_files */
  originalFileId: string;
  /** Storage path to original file */
  originalPath: string;
  /** Name of the original file */
  originalFilename: string;
  source?: JobSource;
  priority?: number;
}

/**
 * Queue a document for processing
 *
 * Called by the queue-job Edge Function to add documents to the queue.
 * Requires mimeType and originalFileId from DB.
 */
app.post("/queue", async (req: Request, res: Response) => {
  try {
    const {
      documentId,
      ownerId,
      mimeType,
      originalFileId,
      originalFilename,
      originalPath,
      source,
      priority,
    } = req.body as QueueJobRequest;

    // Validate required fields
    if (
      !documentId ||
      !ownerId ||
      !mimeType ||
      !originalFilename ||
      !originalFileId ||
      !originalPath
    ) {
      res.status(400).json({
        error:
          "Missing required fields: documentId, ownerId, mimeType, originalFileId, originalPath",
      });
      return;
    }

    // Queue the document
    const jobId = await queueDocumentForProcessing({
      documentId,
      ownerId,
      mimeType,
      originalFileId,
      originalFilename,
      originalPath,
      source: source || "user_upload",
      priority,
    });

    res.json({
      success: true,
      jobId,
      documentId,
      mimeType,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[Queue] Failed to queue document:", errorMessage);
    res.status(500).json({
      error: "Failed to queue document",
      message: errorMessage,
    });
  }
});

// ============================================================================
// Server Startup
// ============================================================================

const server = app.listen(PORT, () => {
  console.log(`[Server] Worker listening on port ${PORT}`);
  console.log(`[Server] Version: ${WORKER_VERSION}`);
  console.log(`[Server] Redis: ${process.env.REDIS_URL}`);

  const llmConfig = getDefaultConfig();

  console.log(`[Server] ocr.provider: ${llmConfig.ocr.provider}`);
  console.log(`[Server] ocr.model: ${llmConfig.ocr.model}`);
  console.log(`[Server] ocr.endpoint: ${llmConfig.ocr.endpoint}`);
  console.log(`[Server] text.provider: ${llmConfig.text.provider}`);
  console.log(`[Server] text.model: ${llmConfig.text.model}`);
  console.log(`[Server] text.endpoint: ${llmConfig.text.endpoint}`);
  console.log(`[Server] vision.provider: ${llmConfig.vision.provider}`);
  console.log(`[Server] vision.model: ${llmConfig.vision.model}`);
  console.log(`[Server] vision.endpoint: ${llmConfig.vision.endpoint}`);
  console.log(`[Server] cache.enabled: ${llmConfig.cache.enabled}`);
  console.log(`[Server] cache.dir: ${llmConfig.cache.dir}`);

  console.log("[Server] Orchestrator and Task workers started");

  // Setup periodic cache cleanup (every 1 hour)
  setInterval(
    () => {
      clearStaleCacheEntries(60 * 60 * 1000).catch((err) =>
        console.error("[Cache] Stale cleanup error:", err),
      );
    },
    60 * 60 * 1000,
  );
});

// ============================================================================
// Graceful Shutdown
// ============================================================================

async function shutdown(signal: string): Promise<void> {
  console.log(`[Server] Received ${signal}, shutting down gracefully...`);

  // Stop accepting new connections
  server.close();

  // Close workers
  await Promise.all([
    orchestratorWorker.close(),
    imageScalingWorker.close(),
    imagePrefilterWorker.close(),
    llmClassifyWorker.close(),
    llmNormalizeWorker.close(),
    llmOcrWorker.close(),
    pdfPreAnalysisWorker.close(),
    pdfSimpleExtractWorker.close(),
    txtSimpleExtractWorker.close(),
    pdfSplitterWorker.close(),
    formatConversionWorker.close(),
  ]);

  // Close queues and Redis connection
  await closeQueues();

  console.log("[Server] Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  console.error("[Server] Uncaught exception:", error);
  shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[Server] Unhandled rejection at:", promise, "reason:", reason);
});
