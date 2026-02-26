/**
 * Subtask processing unit that splits concatenated multi-document PDFs into distinct entities.
 * Triggers recursive document lifecycles for each split child via the orchestrator.
 *
 * @see architecture/processing-workers.md - "Phase 4a: PDF Splitting"
 */

import { Worker, Job, Queue } from "bullmq";
import { PDFDocument } from "pdf-lib";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { connection } from "../queues.js";
import {
  downloadFile,
  uploadFile,
  createChildDocument,
  updateDocumentPrivate,
} from "../supabase.js";
import type { SubtaskInput, PdfSplitResult } from "../types.js";

// Queue for triggering processing of new details
const orchestratorQueue = new Queue("orchestrator", { connection });

/**
 * Extract specific pages from a PDF and save as new PDF
 */
async function extractPages(
  originalPdfBuffer: Buffer,
  pageIndices: number[], // 1-based indices (from pre_analyze.py)
  cropType?: string,
): Promise<Uint8Array> {
  const srcPdf = await PDFDocument.load(originalPdfBuffer);
  const dstPdf = await PDFDocument.create();

  // pdf-lib expects 0-based indices, so convert from 1-based
  const copiedPages = await dstPdf.copyPages(
    srcPdf,
    pageIndices.map((p) => p - 1),
  );

  for (const page of copiedPages) {
    if (cropType) {
      const { x, y, width, height } = page.getMediaBox();
      if (cropType === "top_half") {
        page.setCropBox(x, y + height / 2, width, height / 2);
        page.setMediaBox(x, y + height / 2, width, height / 2);
      } else if (cropType === "bottom_half") {
        page.setCropBox(x, y, width, height / 2);
        page.setMediaBox(x, y, width, height / 2);
      } else if (cropType === "left_half") {
        page.setCropBox(x, y, width / 2, height);
        page.setMediaBox(x, y, width / 2, height);
      } else if (cropType === "right_half") {
        page.setCropBox(x + width / 2, y, width / 2, height);
        page.setMediaBox(x + width / 2, y, width / 2, height);
      }
    }
    dstPdf.addPage(page);
  }

  return await dstPdf.save();
}

/**
 * PDF splitter job processor
 */
async function processPdfSplitterJob(
  job: Job<SubtaskInput>,
): Promise<PdfSplitResult | null> {
  const {
    documentId,
    originalPath,
    ownerId,
    preAnalysis,
    mimeType,
    convertedPdfPath,
  } = job.data;

  // Validate input
  if (mimeType !== "application/pdf" && !convertedPdfPath) {
    console.log(`[PdfSplitter] Skipping non-PDF document ${documentId}`);
    return null;
  }

  if (
    !preAnalysis?.isMultiDocument ||
    !preAnalysis.documents ||
    preAnalysis.documents.length === 0
  ) {
    console.log(
      `[PdfSplitter] Document ${documentId} is not multi-doc or has no split info`,
    );
    return null;
  }

  console.log(
    `[PdfSplitter] Splitting document ${documentId} into ${preAnalysis.documents.length} parts`,
  );

  // Download original PDF once (decrypted via edge function)
  const isConvertedPdf = !!convertedPdfPath;
  const originalBuffer = await downloadFile(
    documentId,
    isConvertedPdf ? "converted_pdf" : "original",
  );
  const tempDir = await mkdtemp(join(tmpdir(), "pdf-split-"));

  try {
    let createdCount = 0;
    const childDocumentIds: string[] = [];

    for (const docInfo of preAnalysis.documents) {
      // 1. Extract pages
      // Handle standardized schema { pages: number[], type: string }
      const type = docInfo.type || "full_page";
      const pageIndices: number[] = docInfo.pages; // 1-based from pre_analyze.py

      const childPdfBytes = await extractPages(
        Buffer.from(originalBuffer),
        pageIndices,
        type,
      );

      // 2. Create child document in DB
      const pageRange = { pages: pageIndices, type: type };
      const childDocId = await createChildDocument(
        documentId,
        ownerId,
        pageRange, // Store page range (JSON) for lineage
        type,
      );

      // Preserve provenance metadata tracing the child to its parent split index
      const childSourceMetadata = {
        sources: {
          "pdf-splitter": {
            source: "pdf-splitter",
            filepath: null,
            original_filename:
              job.data.originalFilename || `split_from_${documentId}.pdf`,
            created_at: new Date().toISOString(),
            modified_at: new Date().toISOString(),
            uploaded_at: new Date().toISOString(),
          },
        },
      };
      await updateDocumentPrivate(childDocId, {
        metadata: childSourceMetadata,
      });

      // 4. Upload child file (encrypted via edge function)
      const uploadResult = await uploadFile(
        childDocId,
        "original",
        Buffer.from(childPdfBytes),
        "application/pdf",
      );

      console.log(
        `[PdfSplitter] Created child document ${childDocId} (${type}, pages: ${pageIndices.join(",")})`,
      );

      // Recursively queue the child document back through the pipeline lifecycle
      // (Variable name 'orchestratorQueue' was targeting 'tasks' in legacy code)
      await orchestratorQueue.add(
        "process-document",
        {
          documentId: childDocId,
          ownerId,
          mimeType: "application/pdf", // Children of PDF split are PDFs
          originalFileId: "child-doc", // Placeholder or need real ID?
          originalPath: uploadResult.storage_path,
          step: "initial", // Start at beginning
          source: "split_child",
          priority: job.priority,
          originalFilename: job.data.originalFilename
            ? `${job.data.originalFilename}_part_${createdCount + 1}.pdf`
            : `split_child_${createdCount + 1}.pdf`,
        },
        {
          jobId: `${childDocId}-orchestrator`,
        },
      );

      createdCount++;
      childDocumentIds.push(childDocId);
    }

    return {
      splitInto: createdCount,
      childDocumentIds,
    };
  } finally {
    // Cleanup
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * PDF splitter worker
 */
export const pdfSplitterWorker = new Worker<
  SubtaskInput,
  PdfSplitResult | null
>(
  "pdf-splitter",
  async (job) => {
    return processPdfSplitterJob(job);
  },
  {
    connection,
    concurrency: 2, // Splitting can be memory intensive
  },
);

pdfSplitterWorker.on("completed", (job) => {
  console.log(`[PdfSplitter] Job ${job.id} completed`);
});

pdfSplitterWorker.on("failed", (job, error) => {
  console.error(`[PdfSplitter] Job ${job?.id} failed:`, error.message);
});

export { processPdfSplitterJob, extractPages };
