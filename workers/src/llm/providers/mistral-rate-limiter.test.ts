/**
 * Validation Suite: mistral-rate-limiter
 * Tests the mistral-rate-limiter module for expected architectural behaviors and edge cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Import after env setup
const { MistralRateLimiter } = await import("./mistral-rate-limiter.js");

describe("MistralRateLimiter", () => {
  beforeEach(() => {
    MistralRateLimiter.resetInstance();
  });

  afterEach(() => {
    MistralRateLimiter.resetInstance();
  });

  describe("singleton", () => {
    it("should return the same instance", () => {
      const a = MistralRateLimiter.getInstance();
      const b = MistralRateLimiter.getInstance();
      expect(a).toBe(b);
    });

    it("should return a new instance after reset", () => {
      const a = MistralRateLimiter.getInstance();
      MistralRateLimiter.resetInstance();
      const b = MistralRateLimiter.getInstance();
      expect(a).not.toBe(b);
    });
  });

  describe("rate limiting", () => {
    it("should space requests by minInterval", async () => {
      const limiter = new MistralRateLimiter(2); // 2 RPS → 500ms interval
      const timestamps: number[] = [];

      const fn = async () => {
        timestamps.push(Date.now());
        return "ok";
      };

      await Promise.all([
        limiter.execute(fn),
        limiter.execute(fn),
        limiter.execute(fn),
      ]);

      expect(timestamps).toHaveLength(3);
      for (let i = 1; i < timestamps.length; i++) {
        const gap = timestamps[i] - timestamps[i - 1];
        expect(gap).toBeGreaterThanOrEqual(450);
      }
    });

    it("should execute calls in FIFO order", async () => {
      const limiter = new MistralRateLimiter(100);
      const order: number[] = [];

      const makeFn = (id: number) => async () => {
        order.push(id);
        return id;
      };

      const results = await Promise.all([
        limiter.execute(makeFn(1)),
        limiter.execute(makeFn(2)),
        limiter.execute(makeFn(3)),
      ]);

      expect(order).toEqual([1, 2, 3]);
      expect(results).toEqual([1, 2, 3]);
    });

    it("should not block dispatch on slow responses", async () => {
      const limiter = new MistralRateLimiter(100);
      const dispatchTimes: number[] = [];

      const slowFn = async () => {
        dispatchTimes.push(Date.now());
        await new Promise((r) => setTimeout(r, 200));
        return "done";
      };

      const start = Date.now();
      const results = await Promise.all([
        limiter.execute(slowFn),
        limiter.execute(slowFn),
        limiter.execute(slowFn),
      ]);
      const totalTime = Date.now() - start;

      expect(results).toEqual(["done", "done", "done"]);
      expect(dispatchTimes).toHaveLength(3);

      const dispatchSpan =
        dispatchTimes[dispatchTimes.length - 1] - dispatchTimes[0];
      expect(dispatchSpan).toBeLessThan(100);
      expect(totalTime).toBeLessThan(400);
    });
  });

  describe("retry on 429", () => {
    it("should re-enqueue on rate_limited error and succeed", async () => {
      const limiter = new MistralRateLimiter(100);
      let callCount = 0;

      const fn = async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error(
            'generic API error (429): {"type":"rate_limited","message":"Rate limit exceeded"}',
          );
        }
        return "success";
      };

      const result = await limiter.execute(fn);
      expect(result).toBe("success");
      expect(callCount).toBe(2);
    });

    it("should not retry on non-rate-limit errors", async () => {
      const limiter = new MistralRateLimiter(100);
      let callCount = 0;

      const fn = async () => {
        callCount++;
        throw new Error("generic API error (500): Internal Server Error");
      };

      await expect(limiter.execute(fn)).rejects.toThrow("500");
      expect(callCount).toBe(1);
    });
  });

  describe("payload-too-large detection", () => {
    it("should NOT retry 429 when body >= 195KB", async () => {
      const limiter = new MistralRateLimiter(100);
      let callCount = 0;

      const fn = async () => {
        callCount++;
        throw new Error(
          'generic API error (429): {"type":"rate_limited","message":"Rate limit exceeded"}',
        );
      };

      // Pass body size >= 195KB
      const largeBodySize = 200 * 1024;
      await expect(limiter.execute(fn, largeBodySize)).rejects.toThrow(
        "NOT a rate limit",
      );
      expect(callCount).toBe(1); // no retry
    });

    it("should retry 429 when body < 195KB", async () => {
      const limiter = new MistralRateLimiter(100);
      let callCount = 0;

      const fn = async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error(
            'generic API error (429): {"type":"rate_limited","message":"Rate limit exceeded"}',
          );
        }
        return "ok";
      };

      const smallBodySize = 10 * 1024;
      const result = await limiter.execute(fn, smallBodySize);
      expect(result).toBe("ok");
      expect(callCount).toBe(2); // retried once
    });
  });
});

