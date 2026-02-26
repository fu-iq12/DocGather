/**
 * Central State Machine for the document processing lifecycle.
 * Implements a reactive, sequential workflow utilizing BullMQ FlowProducers
 * to orchestrate isolated subtask workers based on dynamic heuristics.
 *
 * @see architecture/processing-workers.md - "Orchestrator Role"
 */

import { Worker, Job, WaitingChildrenError } from "bullmq";
import { connection } from "./queues.js";
import {
  writeBackResults,
  markDocumentFailed,
  logProcessStep,
} from "./supabase.js";
import { clearCacheForDocument } from "./file-cache.js";
import { LLMClient } from "./llm/index.js";
import { Queue } from "bullmq";
import type { SubtaskInput, ProcessingResults, JobSource } from "./types.js";

import { addJobToFlow } from "./flow-producer-wrapper.js";
import {
  isImage,
  isOfficeDocument,
  isPdf,
  isTextDocument,
} from "./utils/mime-types.js";
// const flowProducer = new FlowProducer({ connection });

// ============================================================================
// Orchestrator State Machine
// ============================================================================

export enum Step {
  Initial = "initial",
  // PDF specific steps
  PreAnalysis = "pre-analysis",
  WaitPreAnalysis = "wait-pre-analysis",
  Routing = "routing",
  // Format conversion steps
  WaitConversion = "wait-conversion",
  // Action steps
  WaitExtraction = "wait-extraction", // Waits for extract OR scale
  // Text specific steps
  WaitTextExtraction = "wait-text-extraction",
  // Tesseract Pre-Filter
  PreFilter = "pre-filter",
  WaitPreFilter = "wait-pre-filter",
  // Classification & Normalization
  Classify = "classify",
  WaitClassify = "wait-classify",
  Normalize = "normalize",
  WaitNormalize = "wait-normalize",

  // Finish
  Finalize = "finalize",
}

// ============================================================================
// Orchestrator Helpers
// ============================================================================

/**
 * Extracts isolated subtask returns from BullMQ's qualified key structure.
 */
export function findChildValue(
  childrenValues: Record<string, any>,
  queueName: string,
): any | undefined {
  for (const key of Object.keys(childrenValues)) {
    if (key.includes(`:${queueName}:`)) {
      return childrenValues[key];
    }
  }
  return undefined;
}

// ============================================================================
// Helpers to spawn child jobs
// ============================================================================

async function spawnChildJob(
  parentJob: Job,
  name: string,
  data: SubtaskInput,
  opts: any = {},
) {
  try {
    console.log(`[Orchestrator] Spawning ${name} for ${data.documentId}`);
    await addJobToFlow({
      name,
      queueName: name, // Route to specific worker queue
      data,
      opts: {
        ...opts,
        jobId: `${data.documentId}-${name}`,
        failParentOnFailure: true,
        parent: {
          id: parentJob.id,
          queue: parentJob.queueQualifiedName,
        },
      },
    });
  } catch (err) {
    console.error(
      `[Orchestrator-Error] spawnChildJob failed for ${name}:`,
      err,
    );
    throw err;
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

export interface QueueDocumentParams {
  documentId: string;
  mimeType: string;
  originalPath: string;
  originalFileId: string;
  originalFilename: string;
  ownerId: string;
  source?: JobSource;
  priority?: number;
}

export async function queueDocumentForProcessing(
  params: QueueDocumentParams,
): Promise<string> {
  const {
    documentId,
    mimeType,
    originalPath,
    originalFileId,
    originalFilename,
    ownerId,
    source = "user_upload",
    priority,
  } = params;

  // We start with Initial step to allow logic to route
  const flow = await addJobToFlow({
    name: "process-document",
    queueName: "orchestrator",
    data: {
      documentId,
      mimeType,
      originalPath,
      originalFileId,
      originalFilename,
      ownerId,
      source,
      step: Step.Initial,
    },
    opts: {
      jobId: `${documentId}-orchestrator`,
      priority,
    },
  });

  console.log(`[Orchestrator] Queued ${mimeType} document ${documentId}`);

  // Schedule a delayed Mistral file cleanup scan
  try {
    const cleanupQueue = new Queue("mistral-cleanup", { connection });
    await cleanupQueue.add(
      "cleanup",
      {},
      {
        jobId: "cleanup-scheduled",
        delay: 30 * 60 * 1000, // 30 minutes
        removeOnComplete: true,
      },
    );
  } catch (err) {
    console.error(
      `[Orchestrator] Failed to schedule mistral-cleanup job:`,
      err,
    );
  }

  return flow.job.id!;
}

// ============================================================================
// Orchestrator Worker Processor
// ============================================================================

export const orchestratorProcessor = async (job: Job, token?: string) => {
  let currentStep = job.data.step as Step;
  const input = job.data as SubtaskInput;

  // Synchronous phase loop: Allows non-blocking state transitions to execute
  // consecutively within the same worker tick until an asynchronous subtask boundary is hit.
  try {
    while (currentStep !== Step.Finalize) {
      switch (currentStep) {
        case Step.Initial: {
          if (isPdf(input.mimeType)) {
            currentStep = Step.PreAnalysis;
          } else if (isImage(input.mimeType)) {
            await spawnChildJob(job, "image-scaling", input);
            currentStep = Step.WaitExtraction;
          } else if (isTextDocument(input.mimeType)) {
            await logProcessStep(input.documentId, "extracting");
            await spawnChildJob(job, "txt-simple-extract", input);
            currentStep = Step.WaitTextExtraction;
          } else if (isOfficeDocument(input.mimeType)) {
            await logProcessStep(input.documentId, "converting");
            await spawnChildJob(job, "format-conversion", input);
            currentStep = Step.WaitConversion;
          } else {
            // Unknown -> just classify
            currentStep = Step.Classify;
          }
          await job.updateData({ ...input, step: currentStep });
          break;
        }

        // --- Format Conversion Pipeline ---

        case Step.WaitConversion: {
          const shouldWait = await job.moveToWaitingChildren(token!);
          if (shouldWait) {
            throw new WaitingChildrenError();
          }
          // Children done. Read results.
          const childrenValues = await job.getChildrenValues();
          const formatConversion = findChildValue(
            childrenValues,
            "format-conversion",
          );

          if (!formatConversion) {
            console.error(
              `[Orchestrator] Doc ${input.documentId}: Format conversion failed to explicitly return result`,
            );
            await logProcessStep(input.documentId, "rejected", {
              reason: "conversion_failed",
            });
            Object.assign(input, { isRejected: true });
            currentStep = Step.Finalize;
            await job.updateData({ ...input, step: currentStep });
            break;
          }

          // If we have directly extracted text (e.g. from spreadsheets), bypass PDF processing
          if (formatConversion.extractedText) {
            Object.assign(input, {
              extractedText: formatConversion.extractedText,
              extractionMethod: "pdf", // use "pdf" method since it's structured text
            });
            currentStep = Step.Classify;
            await job.updateData({ ...input, step: currentStep });
            break;
          }

          if (!formatConversion.convertedPdfPath) {
            console.error(
              `[Orchestrator] Doc ${input.documentId}: Format conversion missing both PDF path and extracted text`,
            );
            await logProcessStep(input.documentId, "rejected", {
              reason: "conversion_failed",
            });
            Object.assign(input, { isRejected: true });
            currentStep = Step.Finalize;
            await job.updateData({ ...input, step: currentStep });
            break;
          }

          // Update job data with converted content so future steps process it as pdf
          Object.assign(input, {
            convertedPdfPath: formatConversion.convertedPdfPath,
            mimeType: "application/pdf",
          });

          currentStep = Step.PreAnalysis;
          await job.updateData({ ...input, step: currentStep });
          break;
        }

        // --- PDF Pipeline ---

        case Step.PreAnalysis: {
          // If we have a convertedPdfPath, we must inform pre-analyze script to use that local path instead,
          // or we can just download the original path to temp and handle it in the worker.
          // PDF Pre analysis worker handles downloadToTemp(job.data.convertedPdfPath || job.data.originalPath)
          await logProcessStep(input.documentId, "pre_analyzing");
          await spawnChildJob(job, "pdf-pre-analysis", input);
          currentStep = Step.WaitPreAnalysis;
          await job.updateData({ ...input, step: currentStep });
          break;
        }

        case Step.WaitPreAnalysis: {
          const shouldWait = await job.moveToWaitingChildren(token!);
          if (shouldWait) {
            throw new WaitingChildrenError();
          }
          // Children done. Read results.
          const childrenValues = await job.getChildrenValues();
          const preAnalysis = findChildValue(
            childrenValues,
            "pdf-pre-analysis",
          );
          // Update job data with pre-analysis so future steps have it
          Object.assign(input, { preAnalysis });
          await job.updateData({ ...input, step: Step.Routing });
          currentStep = Step.Routing;
          break;
        }

        case Step.Routing: {
          const { preAnalysis } = input;
          if (!preAnalysis) {
            currentStep = Step.Finalize;
            break;
          }

          if (preAnalysis.isMultiDocument) {
            // console.log(
            //   `[Orchestrator] Doc ${input.documentId}: Multi-doc detected. Splitting.`,
            // );
            await logProcessStep(input.documentId, "splitting");
            await spawnChildJob(job, "pdf-splitter", input);
            // After splitter, we are done with THIS parent job.
            // The splitter spawns new orchestrator jobs for children.
            // We need to wait for splitter to confirm it finished, then marks this doc as "split"
            currentStep = Step.WaitExtraction; // Re-use generic wait
          } else if (
            preAnalysis.textQuality === "good" ||
            preAnalysis.textQuality === "best"
          ) {
            // console.log(
            //   `[Orchestrator] Doc ${input.documentId}: Native text PDF. Extracting.`,
            // );
            await logProcessStep(input.documentId, "extracting");
            await spawnChildJob(job, "pdf-simple-extract", input);
            currentStep = Step.WaitExtraction;
          } else {
            // console.log(
            //   `[Orchestrator] Doc ${input.documentId}: Scanned/Image PDF. Scaling + OCR.`,
            // );
            // Poor text -> needs OCR.
            await logProcessStep(input.documentId, "scaling");
            await spawnChildJob(job, "image-scaling", input);
            currentStep = Step.WaitExtraction; // We will wait for image-scaling here
          }
          await job.updateData({ ...input, step: currentStep });
          break;
        }

        // --- Action Wait ---

        case Step.WaitExtraction: {
          const shouldWait = await job.moveToWaitingChildren(token!);
          if (shouldWait) {
            throw new WaitingChildrenError();
          }
          // Check what we have
          const childrenValues = await job.getChildrenValues();

          // 1. Did we split?
          const splitResult = findChildValue(childrenValues, "pdf-splitter");
          if (splitResult) {
            // console.log(
            //   `[Orchestrator] Doc ${input.documentId} split into ${splitResult.splitInto} docs.`,
            // );
            // Mark as split and exit
            await job.updateData({
              ...input,
              splitCompleted: true,
              step: Step.Finalize,
            });
            currentStep = Step.Finalize;
            break;
          }

          // 2. Did we just finish scaling (for scanned PDF)?
          const isImageDoc = isImage(input.mimeType);
          const isPoorPdf =
            input.preAnalysis?.textQuality === "poor" ||
            input.preAnalysis?.textQuality === "none";

          const scalingResult = findChildValue(childrenValues, "image-scaling");
          const ocrResult = findChildValue(childrenValues, "llm-ocr");

          if ((isImageDoc || isPoorPdf) && scalingResult && !ocrResult) {
            const updatedInput = {
              ...input,
              scaledImagePaths: scalingResult.scaledPaths, // Pass paths to OCR
            };
            await job.updateData(updatedInput);
            Object.assign(input, updatedInput);

            // console.log(
            //   `[Orchestrator] Doc ${input.documentId}: Scaling done. Spawning Pre-Filter.`,
            // );
            await logProcessStep(input.documentId, "pre_filtering");
            await spawnChildJob(job, "image-prefilter", input);
            // Go back to waiting
            await job.updateData({ ...input, step: Step.WaitPreFilter });
            const shouldWaitForFilter = await job.moveToWaitingChildren(token!);
            if (shouldWaitForFilter) {
              throw new WaitingChildrenError();
            }
            // Filter done immediately? continue loop
            break;
          }

          // 3. We have extraction (OCR or PDF-extract) -> Move to Classify
          // Read full result objects and inject into input for downstream workers
          const allChildren = await job.getChildrenValues();
          const ocrRes = findChildValue(allChildren, "llm-ocr");
          const pdfRes = findChildValue(allChildren, "pdf-simple-extract");

          // Skip classification if OCR returned no usable text (extractionConfidence=0)
          if (ocrRes && ocrRes.rawText.length === 0) {
            // console.log(
            //   `[Orchestrator] Doc ${input.documentId}: extractionConfidence=0, skipping classify`,
            // );

            await logProcessStep(input.documentId, "rejected", {
              reason: "no_usable_text",
            });
            currentStep = Step.Finalize;

            // Assign dummy rejection classifications to trigger finalizing state correctly
            Object.assign(input, { isRejected: true });

            await job.updateData({ ...input, step: currentStep });
            break;
          }

          const extractedText = ocrRes
            ? JSON.stringify(ocrRes)
            : (pdfRes?.text ?? "");
          const extractionMethod = ocrRes ? "vision" : "pdf";

          Object.assign(input, { extractedText, extractionMethod });

          currentStep = Step.Classify;
          await job.updateData({ ...input, step: currentStep });
          break;
        }

        // --- Text Extraction PIPELINE ---

        case Step.WaitTextExtraction: {
          const shouldWait = await job.moveToWaitingChildren(token!);
          if (shouldWait) {
            throw new WaitingChildrenError();
          }

          const childrenValues = await job.getChildrenValues();
          const txtRes = findChildValue(childrenValues, "txt-simple-extract");

          if (!txtRes || !txtRes.success || !txtRes.text) {
            console.log(
              `[Orchestrator] Doc ${input.documentId}: txt-simple-extract yielded no text.`,
            );
            currentStep = Step.Finalize;
            Object.assign(input, {
              isRejected: true,
              rejectDetails: { reason: "no_usable_text" },
            });
            await job.updateData({ ...input, step: currentStep });
            break;
          }

          const extractedText = txtRes.text;
          const extractionMethod = "pdf"; // use "pdf" layout/format logic for raw text since we won't have coords

          Object.assign(input, { extractedText, extractionMethod });

          currentStep = Step.Classify;
          await job.updateData({ ...input, step: currentStep });
          break;
        }

        // --- Pre-Filter ---

        case Step.WaitPreFilter: {
          const shouldWait = await job.moveToWaitingChildren(token!);
          if (shouldWait) {
            throw new WaitingChildrenError();
          }

          const childrenValues = await job.getChildrenValues();
          const filterResult = findChildValue(
            childrenValues,
            "image-prefilter",
          );

          if (!filterResult?.hasText) {
            console.log(
              `[Orchestrator] Doc ${input.documentId}: No text detected by pre-filter, skipping OCR`,
            );
            Object.assign(input, {
              isRejected: true,
              rejectDetails: { reason: "no_text_detected_in_image" },
            });
            currentStep = Step.Finalize;
            await job.updateData({ ...input, step: currentStep });
            break;
          }

          // Text found → proceed to LLM-OCR
          // console.log(`[Orchestrator] Doc ${input.documentId}: Text detected. Spawning OCR.`);
          await logProcessStep(input.documentId, "extracting");
          await spawnChildJob(job, "llm-ocr", input);
          currentStep = Step.WaitExtraction; // Back to WaitExtraction for OCR result
          await job.updateData({ ...input, step: currentStep });

          // Wait for OCR
          const shouldWaitForOcr = await job.moveToWaitingChildren(token!);
          if (shouldWaitForOcr) throw new WaitingChildrenError();
          break;
        }

        // --- Classification ---

        case Step.Classify: {
          await logProcessStep(input.documentId, "classifying");
          await spawnChildJob(job, "llm-classify", input);
          currentStep = Step.WaitClassify;
          await job.updateData({ ...input, step: currentStep });
          break;
        }

        case Step.WaitClassify: {
          const shouldWait = await job.moveToWaitingChildren(token!);
          if (shouldWait) throw new WaitingChildrenError();

          // Read classification result — skip further processing for irrelevant docs
          const classifyChildren = await job.getChildrenValues();
          const classifyResult = findChildValue(
            classifyChildren,
            "llm-classify",
          );

          if (
            classifyResult?.documentType === "other.irrelevant" ||
            classifyResult?.documentType === "other.unclassified"
          ) {
            console.log(
              `[Orchestrator] Doc ${input.documentId}: classified as ${classifyResult.documentType}, skipping normalize`,
            );
            Object.assign(input, {
              isRejected: true,
              rejectDetails: { documentType: classifyResult.documentType },
            });
            currentStep = Step.Finalize;
            await job.updateData({ ...input, step: currentStep });
            break;
          }

          currentStep = Step.Normalize;
          Object.assign(input, { classification: classifyResult });
          await job.updateData({
            ...input,
            classification: classifyResult,
            step: currentStep,
          });
          break;
        }

        // --- Normalization ---

        case Step.Normalize: {
          await logProcessStep(input.documentId, "normalizing");
          await spawnChildJob(job, "llm-normalize", input);
          currentStep = Step.WaitNormalize;
          await job.updateData({ ...input, step: currentStep });
          break;
        }

        case Step.WaitNormalize: {
          const shouldWait = await job.moveToWaitingChildren(token!);
          if (shouldWait) throw new WaitingChildrenError();
          currentStep = Step.Finalize;
          await job.updateData({ ...input, step: currentStep });
          break;
        }

        default: {
          console.error(`[Orchestrator] Unknown step: ${currentStep}`);
          currentStep = Step.Finalize;
        }
      }
    }
  } catch (loopError) {
    if (loopError instanceof WaitingChildrenError) {
      throw loopError; // Expected — BullMQ will resume this job when children complete
    }
    console.error("[Orchestrator] Unexpected error in step loop:", loopError);
    throw loopError;
  }

  // Finalize: Aggregation & Write-back
  console.log(
    `[Orchestrator] Processing completed for document ${input.documentId}`,
  );

  try {
    const childrenValues = await job.getChildrenValues();
    const results: ProcessingResults = {
      preAnalysis: findChildValue(childrenValues, "pdf-pre-analysis"),
      imageScaling: findChildValue(childrenValues, "image-scaling"),
      imagePrefilter: findChildValue(childrenValues, "image-prefilter"),
      pdfExtract: findChildValue(childrenValues, "pdf-simple-extract"),
      ocrExtract: findChildValue(childrenValues, "llm-ocr"),
      txtExtract: findChildValue(childrenValues, "txt-simple-extract"),
      classification: findChildValue(childrenValues, "llm-classify"),
      normalized: findChildValue(childrenValues, "llm-normalize"),
      pdfSplit: findChildValue(childrenValues, "pdf-splitter"),
      formatConversion: findChildValue(childrenValues, "format-conversion"),
    };

    // If document was split, explicitly set classification to "splitted" so it's recorded in DB
    if (results.pdfSplit && !results.classification) {
      results.classification = {
        documentType: "splitted",
        extractionConfidence: 0,
        language: "unknown",
        explanation: `Document split into ${results.pdfSplit.splitInto} parts`,
      };
    }

    // console.log("[DEBUG]", "results", results, results.normalized);

    const finalStatus = (input as any).isRejected ? "rejected" : "processed";
    await writeBackResults(
      input.documentId,
      results,
      finalStatus,
      (input as any).rejectDetails,
    );

    // Clean up cached files for this document
    await clearCacheForDocument(input.documentId);

    // Clean up Mistral file if one was uploaded
    if (input.llmFileId) {
      try {
        const client = new LLMClient();
        await client.delete(input.llmFileId);
        console.log(
          `[Orchestrator] Deleted Mistral file ${input.llmFileId} for document ${input.documentId}`,
        );
      } catch (e) {
        console.warn(
          `[Orchestrator] Failed to delete Mistral file ${input.llmFileId}:`,
          e,
        );
      }
    }

    const duration = Date.now() - (input as any).startedAt || 0;
    console.log(
      `[Orchestrator] Document ${input.documentId} workflow finished in ${duration}ms`,
    );

    return {
      success: true,
      documentId: input.documentId,
      duration,
      source: input.source,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `[Orchestrator] Failed to finalize document ${input.documentId}:`,
      errorMessage,
    );
    await markDocumentFailed(
      input.documentId,
      errorMessage,
      process.env.FLY_MACHINE_VERSION || "local",
    );
    // Best effort cleanup on error
    await clearCacheForDocument(input.documentId).catch(() => {});
    if (input.llmFileId) {
      const client = new LLMClient();
      await client.delete(input.llmFileId).catch(() => {});
    }
    throw error;
  }
};

// ============================================================================
// Orchestrator Worker Instance
// ============================================================================

export const orchestratorWorker = new Worker(
  "orchestrator",
  orchestratorProcessor,
  {
    connection,
    concurrency: 5,
  },
);

// Event handlers
orchestratorWorker.on("completed", (job) => {
  console.log(`[Orchestrator] Job ${job.id} completed sequence`);
});

orchestratorWorker.on("failed", async (job, error) => {
  console.error(`[Orchestrator] Job ${job?.id} failed:`, error.message);

  let finalErrorMessage = error.message;

  // If the orchestrator failed because a child job failed,
  // extract the original child error from Redis
  const childMatch = error.message.match(/child bull:([^:]+):([^ ]+) failed/);
  if (childMatch) {
    const queueName = childMatch[1];
    const childJobId = childMatch[2];
    try {
      const { taskQueues } = await import("./queues.js");
      const childQueue = taskQueues[queueName as keyof typeof taskQueues];
      if (childQueue) {
        const { Job } = await import("bullmq");
        const childJob = await Job.fromId(childQueue, childJobId);
        if (childJob && childJob.failedReason) {
          finalErrorMessage = childJob.failedReason;
          console.log(
            `[Orchestrator] Extracted child error for ${childJobId}:`,
            finalErrorMessage,
          );
        }
      }
    } catch (e) {
      console.error(
        "[Orchestrator] Failed to fetch child job error details:",
        e,
      );
    }
  }

  if (job?.data?.documentId) {
    try {
      await markDocumentFailed(
        job.data.documentId,
        finalErrorMessage,
        process.env.FLY_MACHINE_VERSION || "local",
      );
      await clearCacheForDocument(job.data.documentId).catch(() => {});
      if (job.data.llmFileId) {
        const client = new LLMClient();
        await client.delete(job.data.llmFileId).catch(() => {});
      }
    } catch (e) {
      console.error(
        `[Orchestrator] Failed to update document status for job ${job.id}:`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }
});

orchestratorWorker.on("error", (error) => {
  console.error("[Orchestrator] Worker error:", error.message);
});
