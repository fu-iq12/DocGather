import { describe, it, expect, vi, beforeEach } from "vitest";
import { processLlmClassifyJob } from "./llm-classify.js";
import type { Job } from "bullmq";
import type { SubtaskInput } from "../types.js";

// Mock dependencies
const mockChat = vi.fn();

vi.mock("../llm/index.js", () => {
  return {
    LLMClient: vi.fn().mockImplementation(() => ({
      chat: mockChat,
    })),
  };
});

vi.mock("../llm/billing.js", () => ({
  trackLlmUsage: vi.fn().mockResolvedValue(undefined),
}));

// Helper to create mock job
function createMockJob(data: Partial<SubtaskInput>): Job<SubtaskInput> {
  return {
    id: "test-job-id",
    name: "llm-classify",
    data: data as SubtaskInput,
    updateProgress: vi.fn(),
    log: vi.fn(),
  } as unknown as Job<SubtaskInput>;
}

describe("processLlmClassifyJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should classify document successfully with valid text", async () => {
    const job = createMockJob({
      documentId: "doc-123",
      extractedText: "BULLETIN DE PAIE\nCompany ABC\nSalary: 2000 EUR",
    });

    const mockResponse = {
      content: JSON.stringify({
        documentType: "income.payslip",
        extractionConfidence: 0.95,
        extractionConfidenceReason: "Good quality image",
        documentSummary: "A payslip",
        language: "fr",
        explanation: "Found 'BULLETIN DE PAIE' keyword",
        sanitizedFilename: "Payslip_Jan_2024.pdf",
        sanitizedSummary: "A payslip for the month of January 2024",
      }),
      model: "test-model",
    };

    mockChat.mockResolvedValue(mockResponse);

    const result = await processLlmClassifyJob(job);

    expect(result).not.toBeNull();
    expect(result?.documentType).toBe("income.payslip");
    expect(result?.extractionConfidence).toBe(0.95);
    expect(mockChat).toHaveBeenCalledTimes(1);

    // improved specific checking
    const callArgs = mockChat.mock.calls[0];
    expect(callArgs[1]).toContain("BULLETIN DE PAIE"); // user message (2nd arg)
  });

  it("should handle empty extracted text by skipping", async () => {
    const job = createMockJob({
      documentId: "doc-empty",
      extractedText: "",
    });

    const result = await processLlmClassifyJob(job);

    expect(result).toBeNull();
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("should handle JSON parsing errors gracefully after 3 retries", async () => {
    const job = createMockJob({
      documentId: "doc-bad-json",
      extractedText: "Some text",
    });

    mockChat.mockResolvedValue({
      content: "This is not JSON",
      model: "test-model",
    });

    const result = await processLlmClassifyJob(job);

    expect(result).not.toBeNull();
    expect(result?.documentType).toBe("other.unclassified");
    expect(result?.explanation).toContain("Validation failed");
    // Should have retried 3 times (1 initial + 2 retries with skipCache)
    expect(mockChat).toHaveBeenCalledTimes(3);
  });

  it("should handle LLM API errors on initial call", async () => {
    const job = createMockJob({
      documentId: "doc-error",
      extractedText: "Some text",
    });

    mockChat.mockRejectedValue(new Error("API Error"));

    await expect(processLlmClassifyJob(job)).rejects.toThrow("API Error");
  });
});
