import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MistralBatchOcr } from "./mistral-batch-ocr.js";
import { MistralRateLimiter } from "./mistral-rate-limiter.js";
import * as mistralFiles from "./mistral-files.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock("./mistral-files.js", () => ({
  downloadFileContent: vi.fn(),
}));

describe("MistralBatchOcr", () => {
  beforeEach(() => {
    MistralBatchOcr.resetInstance();
    MistralRateLimiter.resetInstance();
    mockFetch.mockReset();
    vi.mocked(mistralFiles.downloadFileContent).mockReset();
    vi.useFakeTimers();

    // Ensure that rate limiter check always passes (is completely idle) by default
    // because vi.useFakeTimers() resets Time to 0 but if we don't mock this,
    // the rate limiter might have a stale lastRequestTime from actual Date.now()
    const mockLimiter = { lastRequestTime: 0 };
    vi.spyOn(MistralRateLimiter, "getInstance").mockReturnValue(
      mockLimiter as any,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("singleton", () => {
    it("should return the same instance", () => {
      const a = MistralBatchOcr.getInstance();
      const b = MistralBatchOcr.getInstance();
      expect(a).toBe(b);
    });

    it("should return a new instance after reset", () => {
      const a = MistralBatchOcr.getInstance();
      MistralBatchOcr.resetInstance();
      const b = MistralBatchOcr.getInstance();
      expect(a).not.toBe(b);
    });
  });

  describe("debounce & flush", () => {
    it("should submit a batch after 5s initial wait if not busy", async () => {
      const batchOcr = new MistralBatchOcr("test-key");

      // Setup API mocks
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "job-123",
          status: "SUCCESS",
          output_file: "file-xyz",
        }),
      });
      vi.mocked(mistralFiles.downloadFileContent).mockResolvedValueOnce(
        JSON.stringify({
          custom_id: "test-req",
          response: {
            body: {
              pages: [{ markdown: "hello" }],
              model: "mistral-ocr-latest",
            },
          },
        }) + "\n",
      );

      // We spy on Math.random so customId is deterministic for mocking
      vi.spyOn(Math, "random").mockReturnValue(0.999);
      // We also fake Date.now for the custom_id if needed, but we can just wildcard it

      let resolved: any;
      const promise = batchOcr.execute(
        { type: "file", file_id: "doc-1" },
        "mistral-ocr-latest",
      );
      promise.then((res) => (resolved = res));

      // Advance 4 seconds - not flushed yet
      await vi.advanceTimersByTimeAsync(4000);
      expect(mockFetch).not.toHaveBeenCalled();

      // Advance 1 more second - should trigger checkAndFlush
      await vi.advanceTimersByTimeAsync(1000);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe("https://api.mistral.ai/v1/batch/jobs");
      expect(callArgs[1].method).toBe("POST");

      const payload = JSON.parse(callArgs[1].body);
      expect(payload.model).toBe("mistral-ocr-latest");
      expect(payload.requests).toHaveLength(1);
      expect(payload.requests[0].body.document.file_id).toBe("doc-1");

      // Set Math.random mock back
      vi.mocked(Math.random).mockRestore();
    });

    it("should reset 1s timer while rate limiter is busy", async () => {
      const batchOcr = new MistralBatchOcr("test-key");

      // Setup API mocks
      const mockLimiter = MistralRateLimiter.getInstance() as any;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "job-123",
          status: "SUCCESS",
          output_file: "file-xyz",
        }),
      });
      vi.mocked(mistralFiles.downloadFileContent).mockResolvedValueOnce("");

      batchOcr
        .execute({ type: "file", file_id: "doc-1" }, "mistral-ocr-latest")
        .catch(() => {});

      // Timer starts for 5000ms.
      // We want the rate limiter to be "busy" right when 5000ms hits and the callback checks.
      // Busy means: Date.now() - lastRequestTime < 1000

      // Advance 4900ms
      await vi.advanceTimersByTimeAsync(4900);

      // Someone makes a request, updating lastRequestTime
      mockLimiter.lastRequestTime = Date.now();

      // Advance the last 100ms. Initial wait triggers and sees lastRequestTime was 100ms ago.
      await vi.advanceTimersByTimeAsync(100);

      expect(mockFetch).not.toHaveBeenCalled();

      // Because it was busy, it set another timer for 1000ms.
      // Again, let's keep it busy. Advance 900ms.
      await vi.advanceTimersByTimeAsync(900);

      // Request fires again
      mockLimiter.lastRequestTime = Date.now();

      // Advance 100ms. Second wait triggers, sees busy (100ms ago). Sets 3rd timer.
      await vi.advanceTimersByTimeAsync(100);
      expect(mockFetch).not.toHaveBeenCalled();

      // Now we wait 1000ms *without* updating lastRequestTime.
      await vi.advanceTimersByTimeAsync(1000);

      // Should flush now
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should start a new queue immediately when previous batch flushes", async () => {
      const batchOcr = new MistralBatchOcr("test-key");

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: "job-123",
          status: "SUCCESS",
          output_file: "file-xyz",
        }),
      });
      vi.mocked(mistralFiles.downloadFileContent).mockResolvedValue("");

      batchOcr.execute({}, "model").catch(() => {});

      await vi.advanceTimersByTimeAsync(5000);

      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Now queue is empty. Submit a new item
      batchOcr.execute({}, "model").catch(() => {});

      // After 4 seconds, NO new payload
      await vi.advanceTimersByTimeAsync(4000);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // After 1 more second, flushes second batch
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("polling & resolving", () => {
    it("should poll every 1s until SUCCESS, then download and resolve", async () => {
      const batchOcr = new MistralBatchOcr("test-key");

      // 1. Create job
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "job-123", status: "QUEUED" }),
      });
      // 2. Poll 1
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "job-123", status: "RUNNING" }),
      });
      // 3. Poll 2
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "job-123",
          status: "SUCCESS",
          output_file: "output-xyz",
        }),
      });

      let customIdToMatch = "";
      vi.spyOn(Math, "random").mockReturnValue(0.123);

      const promise = batchOcr.execute(
        { type: "file", file_id: "doc-1" },
        "mistral-model",
      );

      // Find the ID the queue item got
      customIdToMatch = (batchOcr as any).queue[0].customId;

      vi.mocked(mistralFiles.downloadFileContent).mockResolvedValueOnce(
        JSON.stringify({
          custom_id: customIdToMatch,
          response: {
            body: {
              pages: [{ markdown: "Found page" }],
              model: "mistral-model",
            },
          },
        }) + "\n",
      );

      await vi.advanceTimersByTimeAsync(5000); // Trigger flush & Create

      expect(mockFetch).toHaveBeenCalledTimes(1); // Create

      await vi.advanceTimersByTimeAsync(1000); // Sleep for poll 1

      expect(mockFetch).toHaveBeenCalledTimes(2); // Poll 1

      await vi.advanceTimersByTimeAsync(1000); // Sleep for poll 2

      expect(mockFetch).toHaveBeenCalledTimes(3); // Poll 2
      expect(mistralFiles.downloadFileContent).toHaveBeenCalledWith(
        "test-key",
        "output-xyz",
      );

      const result = await promise;
      expect(result.pages[0].markdown).toBe("Found page");

      vi.mocked(Math.random).mockRestore();
    });

    it("should reject all if API returns FAILED", async () => {
      const batchOcr = new MistralBatchOcr("test-key");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "job-123", status: "QUEUED" }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "job-123",
          status: "FAILED",
          error: "Bad Model",
        }),
      });

      const promise = batchOcr.execute({}, "model");
      await vi.advanceTimersByTimeAsync(5000); // Create
      await vi.advanceTimersByTimeAsync(1000); // Poll

      await expect(promise).rejects.toThrow(/ended with status FAILED/);
    });
  });
});
