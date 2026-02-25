import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SB_SECRET_KEY = "test-key";

import {
  orchestratorProcessor,
  Step,
  queueDocumentForProcessing,
} from "./orchestrator.js";

// ---------------------------------------------------------------------------
// Mock external modules BEFORE importing the code under test.
// vi.mock calls are hoisted by vitest, so the order here is fine.
// ---------------------------------------------------------------------------

vi.mock("bullmq", () => ({
  Worker: class {
    on = vi.fn();
  },
  FlowProducer: class {},
  Job: class {},
  FlowJob: class {},
  WaitingChildrenError: class WaitingChildrenError extends Error {
    constructor() {
      super("WaitingChildrenError");
      this.name = "WaitingChildrenError";
    }
  },
}));

vi.mock("./flow-producer-wrapper.js", () => ({
  addJobToFlow: vi.fn().mockResolvedValue({
    job: { id: "mock-flow-job-id" },
    children: [],
  }),
}));

vi.mock("./queues.js", () => ({
  connection: {},
}));

vi.mock("./supabase.js", () => ({
  writeBackResults: vi.fn(),
  markDocumentFailed: vi.fn(),
  updateDocumentPrivate: vi.fn(),
  logProcessStep: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helper: create a mock BullMQ Job for unit tests
// ---------------------------------------------------------------------------

function createMockJob(data: Record<string, any>) {
  // `data` is passed by reference, so updateData mutates it in place
  // and the test can inspect `mockJob.data` directly afterwards.
  return {
    id: `job-${Math.random().toString(36).slice(2, 8)}`,
    data,
    name: "process-document",
    queueQualifiedName: "bull:orchestrator",
    opts: {},

    // ---- BullMQ Job methods ----

    updateData: vi.fn(async (newData: any) => {
      Object.assign(data, newData);
    }),

    // Default: returns true (children pending → throws WaitingChildrenError).
    // Override per-test with `mockJob.moveToWaitingChildren.mockResolvedValueOnce(false)`
    // when you want to simulate "children already completed".
    moveToWaitingChildren: vi.fn(async () => true),

    // Default: returns empty object (no children results).
    // Override per-test with `mockJob.getChildrenValues.mockResolvedValueOnce({...})`.
    getChildrenValues: vi.fn(async () => ({})),

    log: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Orchestrator Processor", () => {
  let mockJob: ReturnType<typeof createMockJob>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockJob = createMockJob({
      documentId: "test-doc",
      ownerId: "user-1",
      mimeType: "application/pdf",
      originalPath: "test/path.pdf",
      originalFileId: "file-1",
      step: Step.Initial,
      source: "user_upload",
    });
  });

  // =========================================================================
  // Initial Step
  // =========================================================================

  describe("Initial Step", () => {
    it("should route Image → spawn scaling+OCR → advance to WaitExtraction → suspend", async () => {
      mockJob = createMockJob({
        documentId: "test-doc-img",
        ownerId: "user-1",
        mimeType: "image/png",
        originalPath: "test/img.png",
        originalFileId: "file-2",
        step: Step.Initial,
        source: "user_upload",
      });

      // The processor will:
      //   Initial → spawn image-scaling, llm-ocr → updateData(WaitExtraction)
      //   WaitExtraction → moveToWaitingChildren returns true → throw WaitingChildrenError
      await expect(
        orchestratorProcessor(mockJob as any, "tok"),
      ).rejects.toThrow();

      // Step should have advanced to wait-extraction
      expect(mockJob.data.step).toBe(Step.WaitExtraction);

      // addJobToFlow should have been called ONCE (image-scaling only)
      const { addJobToFlow } = await import("./flow-producer-wrapper.js");
      expect(addJobToFlow).toHaveBeenCalledTimes(1);
      expect(addJobToFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "image-scaling",
          queueName: "image-scaling",
          opts: expect.objectContaining({
            failParentOnFailure: true,
          }),
        }),
      );
    });

    it("should route PDF → advance through PreAnalysis → WaitPreAnalysis → suspend", async () => {
      // The processor will:
      //   Initial → isPdf → currentStep=PreAnalysis → updateData
      //   PreAnalysis → spawnChildJob(pdf-pre-analysis) → currentStep=WaitPreAnalysis → updateData
      //   WaitPreAnalysis → moveToWaitingChildren returns true → throw WaitingChildrenError
      await expect(
        orchestratorProcessor(mockJob as any, "tok"),
      ).rejects.toThrow();

      // Final step is WaitPreAnalysis (not PreAnalysis), because the loop continues
      expect(mockJob.data.step).toBe(Step.WaitPreAnalysis);
    });

    it("should route unknown MIME → advance through Classify → WaitClassify → suspend", async () => {
      mockJob = createMockJob({
        documentId: "test-doc-unknown",
        ownerId: "user-1",
        mimeType: "application/octet-stream",
        originalPath: "test/doc.txt",
        originalFileId: "file-3",
        step: Step.Initial,
        source: "user_upload",
      });

      await expect(
        orchestratorProcessor(mockJob as any, "tok"),
      ).rejects.toThrow();

      // Initial → Classify → spawn llm-classify → WaitClassify → suspend
      expect(mockJob.data.step).toBe(Step.WaitClassify);
    });
  });

  // =========================================================================
  // PreAnalysis Step (starting mid-pipeline)
  // =========================================================================

  describe("PreAnalysis Step", () => {
    it("should spawn pre-analysis job and eventually suspend at WaitPreAnalysis", async () => {
      mockJob.data.step = Step.PreAnalysis;

      await expect(
        orchestratorProcessor(mockJob as any, "tok"),
      ).rejects.toThrow();

      expect(mockJob.data.step).toBe(Step.WaitPreAnalysis);

      const { addJobToFlow } = await import("./flow-producer-wrapper.js");
      expect(addJobToFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "pdf-pre-analysis",
          queueName: "pdf-pre-analysis",
        }),
      );
    });
  });

  // =========================================================================
  // WaitPreAnalysis Step (children finished)
  // =========================================================================

  describe("WaitPreAnalysis Step", () => {
    it("should read pre-analysis results correctly and advance to Routing -> WaitExtraction (Image Scaling)", async () => {
      mockJob.data.step = Step.WaitPreAnalysis;

      // Simulate: children done, pre-analysis result present
      mockJob.moveToWaitingChildren.mockResolvedValueOnce(false);
      mockJob.getChildrenValues.mockResolvedValue({
        "bull:pdf-pre-analysis:mock-job-1": {
          isMultiDocument: false,
          textQuality: "poor",
          hasTextLayer: false,
        },
      });

      // It should loop: WaitPreAnalysis -> Routing -> Image Scaling -> WaitExtraction
      await expect(
        orchestratorProcessor(mockJob as any, "tok"),
      ).rejects.toThrow();

      // Verify it went to WaitExtraction (meaning it successfully routed)
      expect(mockJob.data.step).toBe(Step.WaitExtraction);

      // Verify the correct child was spawned
      const { addJobToFlow } = await import("./flow-producer-wrapper.js");
      expect(addJobToFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "image-scaling",
          queueName: "image-scaling",
        }),
      );
    });
  });

  // =========================================================================
  // Routing Step (entered after WaitPreAnalysis completes)
  // =========================================================================

  describe("Routing Step", () => {
    it("should route multi-doc to PDF Splitter → WaitExtraction → suspend", async () => {
      mockJob.data.step = Step.Routing;
      mockJob.data.preAnalysis = { isMultiDocument: true };

      await expect(
        orchestratorProcessor(mockJob as any, "tok"),
      ).rejects.toThrow();

      expect(mockJob.data.step).toBe(Step.WaitExtraction);

      const { addJobToFlow } = await import("./flow-producer-wrapper.js");
      expect(addJobToFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "pdf-splitter",
          queueName: "pdf-splitter",
        }),
      );
    });

    it("should route good-quality PDF to simple extract → WaitExtraction → suspend", async () => {
      mockJob.data.step = Step.Routing;
      mockJob.data.preAnalysis = {
        isMultiDocument: false,
        textQuality: "good",
      };

      await expect(
        orchestratorProcessor(mockJob as any, "tok"),
      ).rejects.toThrow();

      expect(mockJob.data.step).toBe(Step.WaitExtraction);

      const { addJobToFlow } = await import("./flow-producer-wrapper.js");
      expect(addJobToFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "pdf-simple-extract",
          queueName: "pdf-simple-extract",
        }),
      );
    });

    it("should route poor-quality PDF to image scaling → WaitExtraction → suspend", async () => {
      mockJob.data.step = Step.Routing;
      mockJob.data.preAnalysis = {
        isMultiDocument: false,
        textQuality: "poor",
      };

      await expect(
        orchestratorProcessor(mockJob as any, "tok"),
      ).rejects.toThrow();

      expect(mockJob.data.step).toBe(Step.WaitExtraction);

      const { addJobToFlow } = await import("./flow-producer-wrapper.js");
      expect(addJobToFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "image-scaling",
          queueName: "image-scaling",
        }),
      );
    });
  });

  // =========================================================================
  // WaitExtraction Step (children already finished)
  // =========================================================================

  describe("WaitExtraction Step", () => {
    it("should detect split completion → finalize with success", async () => {
      mockJob.data.step = Step.WaitExtraction;

      // Simulate: children already completed
      mockJob.moveToWaitingChildren.mockResolvedValueOnce(false);
      mockJob.getChildrenValues.mockResolvedValue({
        "bull:pdf-splitter:mock-split-1": { splitInto: 5 },
      });

      const result = await orchestratorProcessor(mockJob as any, "tok");

      expect(result).toEqual(expect.objectContaining({ success: true }));
      expect(mockJob.data.splitCompleted).toBe(true);
      expect(mockJob.data.step).toBe(Step.Finalize);
    });

    it("should set documentType to 'splitted' when split occurs", async () => {
      mockJob.data.step = Step.WaitExtraction;

      // Simulate: children already completed with split result
      mockJob.moveToWaitingChildren.mockResolvedValueOnce(false);
      mockJob.getChildrenValues.mockResolvedValue({
        "bull:pdf-splitter:mock-split-1": {
          splitInto: 3,
          childDocumentIds: ["c1", "c2", "c3"],
        },
      });

      const result = await orchestratorProcessor(mockJob as any, "tok");

      expect(result).toEqual(expect.objectContaining({ success: true }));

      // Verify writeBackResults was called with correct classification
      const { writeBackResults } = await import("./supabase.js");
      expect(writeBackResults).toHaveBeenCalledWith(
        mockJob.data.documentId,
        expect.objectContaining({
          pdfSplit: expect.objectContaining({ splitInto: 3 }),
          classification: expect.objectContaining({
            documentType: "splitted",
            extractionConfidence: 0,
            explanation: "Document split into 3 parts",
            language: "unknown",
          }),
        }),
        "processed",
        undefined,
      );
    });

    it("should spawn Pre-Filter after scaling is done (reactive correction)", async () => {
      mockJob.data.step = Step.WaitExtraction;
      mockJob.data.mimeType = "application/pdf";
      mockJob.data.preAnalysis = { textQuality: "poor" };

      // Simulate: children done, scaling result present, OCR missing
      mockJob.moveToWaitingChildren.mockResolvedValueOnce(false);
      mockJob.getChildrenValues.mockResolvedValue({
        "bull:image-scaling:mock-scale-1": {
          scaledPaths: ["path/to/img.webp"],
        },
      });

      // Should re-throw WaitingChildrenError after spawning Pre-Filter
      await expect(
        orchestratorProcessor(mockJob as any, "tok"),
      ).rejects.toThrow();

      expect(mockJob.data.scaledImagePaths).toEqual(["path/to/img.webp"]);
      expect(mockJob.data.step).toBe(Step.WaitPreFilter);

      const { addJobToFlow } = await import("./flow-producer-wrapper.js");
      expect(addJobToFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "image-prefilter",
          queueName: "image-prefilter",
        }),
      );
    });

    it("should proceed to Classify when extraction is done", async () => {
      mockJob.data.step = Step.WaitExtraction;

      // Simulate: children done, extraction result present
      mockJob.moveToWaitingChildren.mockResolvedValueOnce(false);
      mockJob.getChildrenValues.mockResolvedValue({
        "bull:pdf-simple-extract:mock-ext-1": { text: "extracted" },
      });

      // After WaitExtraction → Classify → spawn llm-classify → WaitClassify → suspend
      await expect(
        orchestratorProcessor(mockJob as any, "tok"),
      ).rejects.toThrow();

      expect(mockJob.data.step).toBe(Step.WaitClassify);
      expect(mockJob.data.extractedText).toBe("extracted");
    });
  });

  // =========================================================================
  // Pre-Filter Step
  // =========================================================================

  describe("WaitPreFilter Step", () => {
    it("should skip OCR if no text detected", async () => {
      mockJob.data.step = Step.WaitPreFilter;

      // Simulate: children done, no text
      mockJob.moveToWaitingChildren.mockResolvedValueOnce(false);
      mockJob.getChildrenValues.mockResolvedValue({
        "bull:image-prefilter:mock-pf-1": {
          hasText: false,
          charCount: 0,
        },
      });

      // Should finalize immediately
      const result = await orchestratorProcessor(mockJob as any, "tok");
      expect(result).toEqual(expect.objectContaining({ success: true }));
      expect(mockJob.data.step).toBe(Step.Finalize);
    });

    it("should spawn OCR if text detected", async () => {
      mockJob.data.step = Step.WaitPreFilter;

      // Simulate: children done, text found
      mockJob.moveToWaitingChildren.mockResolvedValueOnce(false);
      mockJob.getChildrenValues.mockResolvedValue({
        "bull:image-prefilter:mock-pf-1": {
          hasText: true,
          charCount: 100,
        },
      });

      // Should spawn OCR and wait
      await expect(
        orchestratorProcessor(mockJob as any, "tok"),
      ).rejects.toThrow();

      expect(mockJob.data.step).toBe(Step.WaitExtraction);

      const { addJobToFlow } = await import("./flow-producer-wrapper.js");
      expect(addJobToFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "llm-ocr",
          queueName: "llm-ocr",
        }),
      );
    });
  });

  // =========================================================================
  // WaitClassify Step
  // =========================================================================

  describe("WaitClassify Step", () => {
    it("should proceed to Normalize with classification data", async () => {
      mockJob.data.step = Step.WaitClassify;
      mockJob.data.extractedText = "some text";

      // Simulate: classification done
      mockJob.moveToWaitingChildren.mockResolvedValueOnce(false);
      mockJob.getChildrenValues.mockResolvedValue({
        "bull:llm-classify:mock-cls-1": {
          documentType: "invoice",
          extractionConfidence: 0.9,
          explanation: "Test explanation",
          language: "en",
          sanitizedFilename: "invoice.pdf",
          sanitizedSummary: "Summary",
        },
      });

      // WaitClassify → Normalize → spawn llm-normalize → WaitNormalize → suspend
      await expect(
        orchestratorProcessor(mockJob as any, "tok"),
      ).rejects.toThrow();

      expect(mockJob.data.step).toBe(Step.WaitNormalize);
      expect(mockJob.data.classification).toEqual({
        documentType: "invoice",
        extractionConfidence: 0.9,
        explanation: "Test explanation",
        language: "en",
        sanitizedFilename: "invoice.pdf",
        sanitizedSummary: "Summary",
      });

      const { addJobToFlow } = await import("./flow-producer-wrapper.js");
      expect(addJobToFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "llm-normalize",
          queueName: "llm-normalize",
        }),
      );
    });
  });

  // =========================================================================
  // queueDocumentForProcessing
  // =========================================================================

  describe("queueDocumentForProcessing", () => {
    it("should queue a document using named parameters", async () => {
      const { addJobToFlow } = await import("./flow-producer-wrapper.js");

      const jobId = await queueDocumentForProcessing({
        documentId: "doc-queue-test",
        mimeType: "application/pdf",
        originalPath: "path/to/orig.pdf",
        originalFileId: "file-queue-test",
        originalFilename: "orig.pdf",
        ownerId: "user-queue-test",
        source: "cloud_sync",
      });

      expect(addJobToFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "process-document",
          queueName: "orchestrator",
          data: expect.objectContaining({
            documentId: "doc-queue-test",
            mimeType: "application/pdf",
            source: "cloud_sync",
            step: Step.Initial,
          }),
        }),
      );

      expect(jobId).toBe("mock-flow-job-id");
    });
  });
});
