/**
 * Validation Suite: llm-normalize
 * Tests the llm-normalize module for expected architectural behaviors and edge cases.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { processLlmNormalizeJob } from "./llm-normalize.js";
import type { Job } from "bullmq";
import type { SubtaskInput } from "../types.js";

// Mock dependencies
const mockChat = vi.fn();
const mockVision = vi.fn();

vi.mock("../llm/index.js", () => {
  return {
    LLMClient: vi.fn().mockImplementation(() => ({
      chat: mockChat,
      vision: mockVision,
    })),
  };
});

vi.mock("../llm/billing.js", () => ({
  trackLlmUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../supabase.js", () => ({
  downloadFile: vi.fn(),
}));

// Helper to create mock job
function createMockJob(data: Partial<SubtaskInput>): Job<SubtaskInput> {
  return {
    id: "test-job-id",
    name: "llm-normalize",
    queueName: "llm-normalize", // Required for cachePrefix
    data: data as SubtaskInput,
    updateProgress: vi.fn(),
    log: vi.fn(),
  } as unknown as Job<SubtaskInput>;
}

describe("processLlmNormalizeJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should normalize data successfully for known document type", async () => {
    const job = createMockJob({
      documentId: "doc-123",
      extractedText: "Some Payslip text...",
      classification: {
        documentType: "income.payslip", // known type
        extractionConfidence: 0.9,
        language: "fr",
      },
    });

    const mockResponse = {
      content: JSON.stringify({
        employerName: "ACME Corp",
        employee: {}, // Required by schema
      }),
      model: "test-model",
    };

    mockChat.mockResolvedValue(mockResponse);

    const result = await processLlmNormalizeJob(job);

    expect(result).not.toBeNull();
    expect(result?.template).toBe("income.payslip");
    expect(result?.fields).toEqual({
      employerName: "ACME Corp",
      employee: {},
    });

    // Check request structure
    const callArgs = mockChat.mock.calls[0];
    expect(callArgs[2].responseFormat.type).toBe("json_object");
    expect(callArgs[2].cachePrefix).toContain("llm-normalize/income.payslip");
  });

  it("should handle missing data gracefully", async () => {
    const job = createMockJob({
      documentId: "doc-empty",
      extractedText: "", // missing text
    });

    const result = await processLlmNormalizeJob(job);
    expect(result).toBeNull();
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("should return null after 3 failed parse attempts", async () => {
    const job = createMockJob({
      documentId: "doc-bad-json",
      extractedText: "Text",
      classification: {
        documentType: "income.payslip",
        extractionConfidence: 0.9,
        language: "fr",
      },
    });

    mockChat.mockResolvedValue({
      content: "Not JSON",
      model: "test-model",
    });

    const result = await processLlmNormalizeJob(job);

    expect(result).toBeNull();
    // Should have retried 3 times (1 initial + 2 retries with skipCache)
    expect(mockChat).toHaveBeenCalledTimes(3);
  });
});

