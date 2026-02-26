/**
 * Singleton batch orchestrator for Mistral OCR.
 * Collects requests over a 5-second window (extended by 1s if rate limiter is busy)
 * and submits them as a single inline batch job to halve per-page costs.
 */

import { MistralRateLimiter } from "./mistral-rate-limiter.js";
import { downloadFileContent } from "./mistral-files.js";

interface BatchQueueItem {
  customId: string;
  document: any;
  model: string;
  resolve: (result: OcrPageResult) => void;
  reject: (error: unknown) => void;
}

export interface OcrPageResult {
  pages: Array<{ markdown: string }>;
  model: string;
}

const INLINE_BATCH_LIMIT = 1000;
const INITIAL_WAIT_MS = 5000;
const BUSY_WAIT_MS = 1000;
const POLL_INTERVAL_MS = 1000;

export class MistralBatchOcr {
  private static instance: MistralBatchOcr | null = null;
  private queue: BatchQueueItem[] = [];
  private batchCounter = 0;
  private timer: NodeJS.Timeout | null = null;
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.MISTRAL_API_KEY || "";
    if (!this.apiKey) {
      console.warn("[MistralBatchOcr] MISTRAL_API_KEY is not set.");
    }
  }

  static getInstance(): MistralBatchOcr {
    if (!MistralBatchOcr.instance) {
      MistralBatchOcr.instance = new MistralBatchOcr();
    }
    return MistralBatchOcr.instance;
  }

  static resetInstance(): void {
    MistralBatchOcr.instance = null;
  }

  /**
   * Pushes a document request onto the batch queue.
   */
  execute(document: any, model: string): Promise<OcrPageResult> {
    return new Promise<OcrPageResult>((resolve, reject) => {
      const customId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      this.queue.push({
        customId,
        document,
        model,
        resolve,
        reject,
      });

      this._ensureTimer();

      // If we hit the absolute max size for inline batching, force a flush immediately.
      if (this.queue.length >= INLINE_BATCH_LIMIT) {
        this._flush();
      }
    });
  }

  private _ensureTimer() {
    if (this.timer) return; // Timer already running

    // Start initial wait
    this.timer = setTimeout(() => this._checkAndFlush(), INITIAL_WAIT_MS);
  }

  private _checkAndFlush() {
    const rateLimiter = MistralRateLimiter.getInstance();
    // Use any property that indicates busyness or recent activity.
    // The rate limiter exposes `lastRequestTime` but it might be private.
    // We can cast to any to read it, or assume it's publicly readable.
    const lastRequestTime = (rateLimiter as any).lastRequestTime || 0;

    // If rate limiter was used within the last second, we consider it "busy"
    if (Date.now() - lastRequestTime < BUSY_WAIT_MS) {
      // Repeat 1s wait
      this.timer = setTimeout(() => this._checkAndFlush(), BUSY_WAIT_MS);
    } else {
      this._flush();
    }
  }

  private async _flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.queue.length === 0) return;

    // Snapshot the current queue and clear it to accept new requests immediately
    const batchItems = [...this.queue];
    this.queue = [];

    const batchIdLocal = ++this.batchCounter;

    try {
      await this._processBatch(batchItems, batchIdLocal);
    } catch (err) {
      // If batch creation or polling fails fatally, reject all items
      console.error(
        `[MistralBatchOcr] Batch #${batchIdLocal} failed fatally:`,
        err,
      );
      for (const item of batchItems) {
        item.reject(err);
      }
    }
  }

  private async _processBatch(items: BatchQueueItem[], batchIdLocal: number) {
    if (items.length === 0) return;

    console.log(
      `[MistralBatchOcr] Creating batch #${batchIdLocal} with ${items.length} requests`,
    );

    // All items in a batch must share the same model. We use the model of the first item.
    // (In practice, llmClient uses one OCR model, so this is fine).
    const model = items[0].model;

    const requests = items.map((item) => ({
      custom_id: item.customId,
      body: {
        model: item.model,
        document: item.document,
      },
    }));

    const batchPayload = {
      model,
      endpoint: "/v1/ocr",
      requests,
    };

    console.log("batchPayload", batchPayload);

    // We CAN wrap this in MistralRateLimiter if we want to be safe about global RPS limits.
    // We will do direct calls for the batch jobs themselves so we don't block the rate limiter queue.
    const createRes = await fetch("https://api.mistral.ai/v1/batch/jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(batchPayload),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(
        `Failed to create batch job: ${createRes.status} ${errText}`,
      );
    }

    const jobData = (await createRes.json()) as {
      id: string;
      status: string;
      output_file?: string;
      error?: any;
    };
    const jobId = jobData.id;

    console.log(
      `[MistralBatchOcr] Batch #${batchIdLocal} created successfully. Job ID: ${jobId}. Polling...`,
    );

    // Poll until complete
    let finalJobState = jobData;
    while (
      finalJobState.status === "QUEUED" ||
      finalJobState.status === "RUNNING"
    ) {
      await this._sleep(POLL_INTERVAL_MS);

      const pollRes = await fetch(
        `https://api.mistral.ai/v1/batch/jobs/${jobId}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        },
      );

      if (!pollRes.ok) {
        const errText = await pollRes.text();
        // It's possible the API hiccuped.
        // For simplicity, we throw on poll error to fail the batch.
        throw new Error(
          `Failed to poll batch job ${jobId}: ${pollRes.status} ${errText}`,
        );
      }

      finalJobState = (await pollRes.json()) as {
        id: string;
        status: string;
        output_file?: string;
        error?: any;
      };
    }

    if (finalJobState.status !== "SUCCESS") {
      throw new Error(
        `Batch job ${jobId} ended with status ${finalJobState.status}: ${JSON.stringify(finalJobState.error)}`,
      );
    }

    if (!finalJobState.output_file) {
      throw new Error(
        `Batch job ${jobId} succeeded but no output_file was provided.`,
      );
    }

    // Download the results
    console.log(
      `[MistralBatchOcr] Batch #${batchIdLocal} SUCCESS. Downloading results file ${finalJobState.output_file}`,
    );
    const resultsJsonl = await downloadFileContent(
      this.apiKey,
      finalJobState.output_file,
    );

    // Parse JSONL and satisfy promises
    const lines = resultsJsonl.split("\n").filter((l) => l.trim().length > 0);
    const resultMap = new Map<string, any>();

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.custom_id) {
          resultMap.set(parsed.custom_id, parsed);
        }
      } catch (e) {
        console.warn(
          `[MistralBatchOcr] Failed to parse JSONL line in batch result: ${line}`,
        );
      }
    }

    for (const item of items) {
      const resultObj = resultMap.get(item.customId);
      if (!resultObj) {
        item.reject(
          new Error(`Custom ID ${item.customId} not found in batch results.`),
        );
        continue;
      }

      const responseBody = resultObj.response?.body;
      if (responseBody?.pages) {
        item.resolve({
          pages: responseBody.pages,
          model: responseBody.model || item.model,
        });
      } else {
        item.reject(
          new Error(
            `Invalid response body for ${item.customId}: ${JSON.stringify(resultObj)}`,
          ),
        );
      }
    }
  }

  private _sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
