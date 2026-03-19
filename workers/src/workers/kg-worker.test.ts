/**
 * Validation Suite: kg-worker
 * Tests the Knowledge Graph ingestion worker for expected architectural behaviors and edge cases.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Job } from "bullmq";

// Use vi.hoisted to define mocks that can be used inside vi.mock factory
const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  getPendingKgDocuments: vi.fn(),
  getKnowledgeGraph: vi.fn(),
  ensureOwnerEntity: vi.fn(),
  applyKgMutations: vi.fn(),
  logKgBatchError: vi.fn(),
  countPendingKgDocuments: vi.fn(),
}));

// Mock LLMClient
vi.mock("../llm/index.js", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    LLMClient: vi.fn().mockImplementation(() => ({
      chat: mocks.chat,
    })),
  };
});

// Mock Supabase RPC helpers
vi.mock("../supabase.js", () => ({
  getPendingKgDocuments: (...args: unknown[]) =>
    mocks.getPendingKgDocuments(...args),
  getKnowledgeGraph: (...args: unknown[]) => mocks.getKnowledgeGraph(...args),
  ensureOwnerEntity: (...args: unknown[]) => mocks.ensureOwnerEntity(...args),
  applyKgMutations: (...args: unknown[]) => mocks.applyKgMutations(...args),
  logKgBatchError: (...args: unknown[]) => mocks.logKgBatchError(...args),
  countPendingKgDocuments: (...args: unknown[]) =>
    mocks.countPendingKgDocuments(...args), // Added
}));

// Mock queues / connection
vi.mock("bullmq", () => ({
  Worker: class {
    on() {}
    close() {}
  },
}));

vi.mock("@langfuse/client", () => ({
  LangfuseClient: vi.fn().mockImplementation(() => ({
    prompt: {
      get: vi.fn().mockResolvedValue({
        compile: vi.fn().mockReturnValue("compiled_prompt"),
      }),
    },
  })),
}));

vi.mock("../queues.js", () => ({
  connection: {},
}));

// Initial import (the mock intercepts it)
import { kgWorker, processKgBatch as realProcessKgBatch } from "./kg-worker.js";
// We need to extract processKgBatch function which is not explicitly exported,
// so we'll mock the Worker constructor in a way that lets us capture the processor.

describe("kg-worker", () => {
  let processKgBatch: (job: Job) => Promise<any>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Explicitly reset implementations & queues to prevent cross-test leaking
    mocks.getPendingKgDocuments.mockReset();
    mocks.getKnowledgeGraph.mockReset();
    mocks.ensureOwnerEntity.mockReset();
    mocks.applyKgMutations.mockReset();
    mocks.logKgBatchError.mockReset();
    mocks.countPendingKgDocuments.mockReset();
    mocks.chat.mockReset();

    // Assign the imported function so tests can use it
    processKgBatch = realProcessKgBatch;

    // Default mock returns
    mocks.getPendingKgDocuments.mockResolvedValue([]);
    mocks.getKnowledgeGraph.mockResolvedValue({
      entities: [],
      relationships: [],
      confirmed_overrides: [],
    });
    mocks.ensureOwnerEntity.mockResolvedValue("owner-entity-uid-123");
    mocks.applyKgMutations.mockResolvedValue({
      entities_added: 0,
      entities_updated: 0,
    });
    mocks.logKgBatchError.mockResolvedValue(undefined);
    mocks.countPendingKgDocuments.mockResolvedValue(0); // Added
    mocks.chat.mockResolvedValue({ content: "{}" });

    // Since processKgBatch is not exported, we need to get it via the vi.mock factory's captured arguments,
    // actually, a better pattern here is just to re-import it with the mock setup.
    // However, vitest makes capturing the internal function passed to new Worker tricky if not exported.
    // Let's modify kg-worker.ts to export the function for testing, or we can just run it once.
  });

  describe("processKgBatch", () => {
    it("should skip processing if no pending docs are found", async () => {
      const job = { data: { ownerId: "owner-1" }, id: "batch-1" } as any;
      mocks.getPendingKgDocuments.mockResolvedValue([]);

      const result = await processKgBatch(job);

      expect(result).toBeNull();
      expect(mocks.ensureOwnerEntity).not.toHaveBeenCalled();
      expect(mocks.chat).not.toHaveBeenCalled();
    });

    it("should process docs, call LLM, and apply mutations", async () => {
      const job = {
        data: { ownerId: "owner-1", documentIds: ["doc-1"] },
        id: "batch-1",
        updateData: vi.fn(),
      } as any;
      mocks.getPendingKgDocuments
        .mockResolvedValueOnce([
          {
            document_id: "doc-1",
            document_type: "invoice",
            document_date: "2024-01-01",
            extracted_data: { total: 100 },
          },
        ])
        .mockResolvedValueOnce([]); // Empty on 2nd loop to break while(true)

      const mockLlmResponse = {
        mutations: {
          entities: [],
          relationships: [],
        },
        attributions: [],
        reasoning: "Test valid response",
      };

      mocks.chat.mockResolvedValue({
        content: JSON.stringify(mockLlmResponse),
      });

      const result = await processKgBatch(job);

      expect(mocks.ensureOwnerEntity).toHaveBeenCalledWith("owner-1");
      expect(mocks.getKnowledgeGraph).toHaveBeenCalledWith("owner-1");
      expect(mocks.chat).toHaveBeenCalledTimes(1);
      expect(mocks.applyKgMutations).toHaveBeenCalledWith(
        "owner-1",
        mockLlmResponse.mutations,
        mockLlmResponse.attributions,
        ["doc-1"],
        expect.any(Object),
      );
    });

    it("should retry LLM if schema validation fails", async () => {
      const job = {
        data: { ownerId: "owner-1", documentIds: ["doc-1"] },
        id: "batch-1",
        updateData: vi.fn(),
      } as any;
      mocks.getPendingKgDocuments
        .mockResolvedValueOnce([
          { document_id: "doc-1", document_type: "invoice" },
        ])
        .mockResolvedValueOnce([]); // Break loop

      const mockValidLlmResponse = {
        mutations: {
          entities: [],
          relationships: [],
        },
        attributions: [],
        reasoning: "Valid on second try",
      };

      // 1st call: returns an object that parses correctly as JSON but fails Zod schema validation
      const mockInvalidSchemaResponse = {
        mutations: {
          entities_to_add: [],
        },
        // missing reasoning and attributions to trigger Zod validation error
      };

      mocks.chat
        .mockResolvedValueOnce({
          content: JSON.stringify(mockInvalidSchemaResponse),
        })
        .mockResolvedValueOnce({
          content: JSON.stringify(mockValidLlmResponse),
        });

      await processKgBatch(job);

      // Should have been called twice due to the retry
      expect(mocks.chat).toHaveBeenCalledTimes(2);
      expect(mocks.applyKgMutations).toHaveBeenCalledTimes(1);
    });

    it("should fallback and log error if LLM fails 3 times", async () => {
      const job = {
        data: { ownerId: "owner-1", documentIds: ["doc-1"] },
        id: "batch-1",
        updateData: vi.fn(),
      } as any;
      mocks.getPendingKgDocuments.mockResolvedValueOnce([
        { document_id: "doc-1", document_type: "invoice" },
      ]); // No need to mock 2nd loop because it will throw

      // Always return invalid structure (fails Zod schema validation)
      mocks.chat.mockResolvedValue({ content: `{"wrong_schema": true}` });

      await expect(processKgBatch(job)).rejects.toThrow(
        /validation failed after/i,
      );

      expect(mocks.chat).toHaveBeenCalledTimes(3);
      expect(mocks.applyKgMutations).not.toHaveBeenCalled();
      expect(mocks.logKgBatchError).toHaveBeenCalledWith(
        "owner-1",
        ["doc-1"],
        expect.any(String),
      );
    });

    it("should re-queue immediately when remaining docs >= batch size", async () => {
      const job = {
        data: { ownerId: "owner-1", documentIds: ["acc-1"] },
        id: "batch-1",
        updateData: vi.fn(),
      } as any;
      mocks.getPendingKgDocuments
        .mockResolvedValueOnce([
          { document_id: "doc-1", document_type: "invoice" },
        ])
        .mockResolvedValueOnce([]); // Break loop

      const mockValidLlmResponse = {
        mutations: {
          entities: [],
          relationships: [],
        },
        attributions: [],
        reasoning: "Valid",
      };

      mocks.chat.mockResolvedValueOnce({
        content: JSON.stringify(mockValidLlmResponse),
      });

      // Simulate 12 remaining docs (>= default batchSize of 10)
      mocks.countPendingKgDocuments.mockResolvedValueOnce(12);

      const result = await processKgBatch(job);

      expect(result._requeue).toEqual({
        ownerId: "owner-1",
        documentIds: ["acc-1"], // keeps accumulator untouched
        remainingCount: 12,
      });
    });

    it("should re-queue with delay when remaining docs < batch size but > 0", async () => {
      const job = {
        data: { ownerId: "owner-1", documentIds: ["acc-1"] },
        id: "batch-1",
        updateData: vi.fn(),
      } as any;
      mocks.getPendingKgDocuments
        .mockResolvedValueOnce([
          { document_id: "doc-1", document_type: "invoice" },
        ])
        .mockResolvedValueOnce([]); // Break loop

      const mockValidLlmResponse = {
        mutations: {
          entities: [],
          relationships: [],
        },
        attributions: [],
        reasoning: "Valid",
      };

      mocks.chat.mockResolvedValueOnce({
        content: JSON.stringify(mockValidLlmResponse),
      });

      // Simulate 3 remaining docs (< batchSize of 10)
      mocks.countPendingKgDocuments.mockResolvedValueOnce(3);

      const result = await processKgBatch(job);

      expect(result._requeue).toEqual({
        ownerId: "owner-1",
        documentIds: ["acc-1"], // keeps accumulator untouched
        remainingCount: 3,
      });
    });

    it("should not re-queue when no remaining docs", async () => {
      const job = {
        data: { ownerId: "owner-1", documentIds: ["acc-1"] },
        id: "batch-1",
        updateData: vi.fn(),
      } as any;
      mocks.getPendingKgDocuments
        .mockResolvedValueOnce([
          { document_id: "doc-1", document_type: "invoice" },
        ])
        .mockResolvedValueOnce([]); // Break loop

      const mockValidLlmResponse = {
        mutations: {
          entities: [],
          relationships: [],
        },
        attributions: [],
        reasoning: "Valid",
      };

      mocks.chat.mockResolvedValueOnce({
        content: JSON.stringify(mockValidLlmResponse),
      });

      // Simulate 0 remaining docs
      mocks.countPendingKgDocuments.mockResolvedValueOnce(0);

      const result = await processKgBatch(job);

      expect(result._requeue).toBeNull();
    });
  });
});
