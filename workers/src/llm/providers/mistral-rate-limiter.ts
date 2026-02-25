/**
 * Mistral Global Rate Limiter
 *
 * Singleton token-bucket rate limiter shared across all Mistral-based providers
 * (mistral chat + mistral-ocr). Mistral enforces a global API rate limit
 * across all endpoints sharing the same API key.
 *
 * On 429 rate-limit errors, the request is re-enqueued at the front of the
 * queue and retried after the next spacing interval (unlimited retries).
 * Payloads >= 195KB that get 429 are NOT retried (payload-too-large, not rate limit).
 *
 * Controlled by MISTRAL_MAX_RPS env var (default: 1 request per second).
 */

interface QueueItem<T> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  retries: number;
  bodySizeBytes: number;
}

const BODY_SIZE_LIMIT_BYTES = 195 * 1024; // 195KB

export class MistralRateLimiter {
  private static instance: MistralRateLimiter | null = null;

  private queue: QueueItem<any>[] = [];
  private processing = false;
  private lastRequestTime = 0;
  private readonly minIntervalMs: number;

  constructor(maxRps?: number) {
    const rps =
      (maxRps ?? parseInt(process.env.MISTRAL_MAX_RPS || "1", 10)) || 1;
    this.minIntervalMs = Math.ceil(1000 / rps);
  }

  static getInstance(): MistralRateLimiter {
    if (!MistralRateLimiter.instance) {
      MistralRateLimiter.instance = new MistralRateLimiter();
    }
    return MistralRateLimiter.instance;
  }

  static resetInstance(): void {
    MistralRateLimiter.instance = null;
  }

  /**
   * Execute an async function through the rate limiter.
   * @param fn - The async function to execute
   * @param bodySizeBytes - Request body size in bytes (for payload-too-large detection)
   */
  execute<T>(fn: () => Promise<T>, bodySizeBytes?: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        fn,
        resolve,
        reject,
        retries: 0,
        bodySizeBytes: bodySizeBytes || 0,
      });
      this._processQueue();
    });
  }

  private async _processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;

      // Enforce minimum interval between requests
      const now = Date.now();
      const elapsed = now - this.lastRequestTime;
      if (elapsed < this.minIntervalMs) {
        await this._sleep(this.minIntervalMs - elapsed);
      }

      this.lastRequestTime = Date.now();

      // Fire and forget — don't block dispatch on response
      item
        .fn()
        .then((result) => {
          item.resolve(result);
        })
        .catch((err) => {
          if (this._isRateLimitError(err)) {
            // Large payloads get 429 from Mistral but it's not a real rate limit
            const sizeKB = (item.bodySizeBytes / 1024).toFixed(1);
            if (item.bodySizeBytes >= BODY_SIZE_LIMIT_BYTES) {
              item.reject(
                new Error(
                  `Mistral rejected payload (${sizeKB}KB >= 195KB limit) with 429 — NOT a rate limit, skipping retry`,
                ),
              );
            } else {
              item.retries++;
              console.warn(
                `[MistralRateLimiter] Rate limited, re-enqueuing (retry #${item.retries}) - ${sizeKB}KB`,
              );
              this.queue.unshift(item);
              this._processQueue();
            }
          } else {
            item.reject(err);
          }
        });
    }

    this.processing = false;
  }

  private _isRateLimitError(err: unknown): boolean {
    if (err instanceof Error) {
      return (
        err.message.includes("rate_limited") ||
        err.message.includes("Rate limit") ||
        err.message.includes("(429)")
      );
    }
    return false;
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
