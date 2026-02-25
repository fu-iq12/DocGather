# Processing Workers Subproject

> **Architecture**: BullMQ + Fly.io workers (reactive orchestrator, scale-to-zero)
>
> **Status**: Reactive orchestrator implemented & tested

This document contains heavy document processing tasks extracted from the main checklist. These run on Fly.io workers due to Supabase Edge Function limitations (CPU/memory/duration).

---

## Overview

### High-Level Architecture

```
┌────────────────┐     ┌──────────────────┐     ┌─────────────────────────────┐
│  queue-job     │────▶│   Upstash Redis  │────▶│   Orchestrator Worker       │
│  Edge Function │     │   (BullMQ)       │     │   (Reactive State Machine)  │
└────────────────┘     └──────────────────┘     └─────────────────────────────┘
                                                              │
                                              ┌───────────────┼─ step loop ──┐
                                              │  spawn child → wait → read   │
                                              │  result → decide next step   │
                                              └───────────────┼──────────────┘
                                                              │
                    ┌──────────────┬──────────────┬───────────┼───────────┬──────────────┬──────────────┬──────────────┬──────────────┐
                    ▼              ▼              ▼           ▼           ▼              ▼              ▼              ▼
             ┌────────────┐ ┌────────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐ ┌────────────┐ ┌──────────┐ ┌──────────┐
             │   Format   │ │   Text     │ │ Pre-     │ │ Image    │ │ Image      │ │    LLM     │ │   LLM    │ │   LLM    │
             │ Conversion │ │ Extraction │ │ Analysis │ │ Scaling  │ │ Pre-Filter │ │    OCR     │ │ Classify │ │ Normalize│
             └────────────┘ └────────────┘ └──────────┘ └──────────┘ └────────────┘ └────────────┘ └──────────┘ └──────────┘
                                                              │
                                                              ▼
                                                  ┌────────────────────┐
                                                  │  Finalize          │
                                                  │  → Supabase RPC    │
                                                  └────────────────────┘
```

### Key Components

| Component              | Description                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Upstash Redis**      | Serverless Redis for BullMQ queue backend                                                                           |
| **Orchestrator**       | Reactive state machine — spawns one step at a time, reads result, routes next                                       |
| **Task Workers**       | pre-analysis, format-conversion, text-extract, image-scaling, image-prefilter, llm-ocr, llm-classify, llm-normalize |
| **FlowProducer**       | Wrapped via `flow-producer-wrapper.ts` for testability                                                              |
| **Monorepo Structure** | Workers in `workers/` subfolder with fly.toml                                                                       |

### Bursty Workload Design

> [!NOTE]
> **Expected pattern**: Long idle periods followed by bursts (e.g., analyzing a full Google Drive).
>
> - Fly.io machines scale to 0 during idle
> - HTTP waker endpoint triggers scale-up
> - Upstash serverless Redis handles connection surge

### Worker Authentication

Workers authenticate using a dedicated **Service Key** (`SB_SECRET_KEY`) which validates them against the Supabase secrets.

- **Authentication Strategy**: `apikey` header validation in Edge Functions
- **Middleware**: `_shared/middleware/service-key-auth.ts` checking `req.headers.get("apikey") === SB_SECRET_KEY`

### Encrypted Storage Access

Workers do **not** access the bucket directly. They use dedicated Edge Functions to handle encryption/decryption transparently:

| Function           | Endpoint                | Auth     | Purpose                                                       |
| :----------------- | :---------------------- | :------- | :------------------------------------------------------------ |
| `storage-download` | `GET /storage-download` | `apikey` | Decrypts document file and streams plaintext to worker        |
| `storage-upload`   | `POST /storage-upload`  | `apikey` | Encrypts file from worker and upserts `document_files` record |

```typescript
// Worker storage access example (wrappers in workers/src/supabase.ts)

// Download (decrypts automatically)
const buffer = await downloadFile(documentId, "original");

// Upload (encrypts + creates DB record automatically)
const { storage_path } = await uploadFile(
  documentId,
  "scaled",
  imageBuffer,
  "image/webp",
);
```

> [!NOTE]
> `verify_jwt = false` is set in `config.toml` for these functions to allow service-key auth.

### Storage Path Convention ✅

Implemented in `_shared/storage.ts` — tested in `storage.test.ts` (11 tests):

| Path Type     | Structure                                     |
| ------------- | --------------------------------------------- |
| Original      | `{owner_id}/{document_id}/original.{ext}`     |
| Converted PDF | `{owner_id}/{document_id}/converted_pdf.pdf`  |
| LLM Optimized | `{owner_id}/{document_id}/llm_optimized.webp` |

---

## Monorepo Structure

Workers live in a dedicated `workers/` subfolder within the monorepo:

```
DocGather/
├── supabase/              # Supabase Edge Functions + DB migrations
├── docs/
├── workers/               # Fly.io workers (self-contained)
│   ├── fly.toml           # Fly.io app config
│   ├── Dockerfile         # Multi-stage build (Node + Python + binaries)
│   ├── docker-compose.yml # Local development
│   ├── package.json       # Worker dependencies (bullmq, ioredis, etc.)
│   ├── tsconfig.json
│   ├── .env.example       # Environment template
├── src/
│   │   ├── index.ts                   # HTTP waker + worker bootstrap
│   │   ├── orchestrator.ts            # Reactive state machine orchestrator
│   │   ├── orchestrator.test.ts       # Orchestrator unit tests (10 tests)
│   │   ├── flow-producer-wrapper.ts   # FlowProducer abstraction (testable)
│   │   ├── queues.ts                  # Queue definitions
│   │   ├── types.ts                   # Message contracts (SubtaskInput, results)
│   │   ├── supabase.ts                # Write-back utilities
│   │   ├── workers/                   # Task workers
│   │   │   ├── format-conversion.ts   # Office/Email to PDF conversion
│   │   │   ├── image-scaling.ts       # Image resizing
│   │   │   ├── image-prefilter.ts     # Tesseract-based pre-filter
│   │   │   ├── llm-ocr.ts             # LLM Vision OCR (images + scanned PDFs)
│   │   │   ├── pdf-pre-analysis.ts    # PDF text quality/multi-doc detection
│   │   │   ├── pdf-simple-extract.ts  # Native PDF text extraction
│   │   │   ├── pdf-splitter.ts        # Split multi-document PDFs
│   │   │   ├── txt-simple-extract.ts  # Text/Markdown/CSV extraction
│   │   │   ├── llm-classify.ts        # Document classification
│   │   │   ├── llm-normalize.ts       # Structured data extraction
│   │   │   └── *.test.ts              # Per-worker unit tests
│   │   ├── llm/                       # LLM provider abstraction
│   │   │   ├── index.ts               # Unified LLMClient
│   │   │   ├── ovhcloud.ts            # OVHcloud AI Endpoints
│   │   │   ├── ollama.ts              # Local Ollama for dev
│   │   │   └── cache.ts               # Disk cache
│   │   └── processors/                # Processing utilities
│   │       ├── python.ts              # Python bridge
│   │       └── python/                # Python scripts
│   └── scripts/
│       └── install-deps.sh            # Binary/Python dependency installer
└── package.json                       # Root monorepo package.json
```

---

## Message Contracts

### Orchestrator → Subtask Input

Each child job receives a standardized message from the orchestrator:

```typescript
interface SubtaskInput {
  documentId: string;
  ownerId: string;
  /** MIME type from document_files (detected via magic bytes at upload) */
  mimeType: string;
  /** ID of the original file in document_files */
  originalFileId: string;
  /** Storage path to original file */
  originalPath: string;
  /** Current step in the orchestration flow (for reactive jobs) */
  step?: Step;
  /** Source of the job */
  source?: JobSource; // "user_upload" | "cloud_sync" | "retry"
  // Populated by previous steps:
  convertedPdfPath?: string;
  scaledImagePaths?: string[];
  extractedText?: string;
  preAnalysis?: PreAnalysisResult;
  classification?: LlmClassificationResult;
  /** Method used for text extraction (vision or pdf) */
  extractionMethod?: "vision" | "pdf";
  /** Set when a multi-doc PDF is split — parent job stops here */
  splitCompleted?: boolean;
}
```

> [!NOTE]
> The `mimeType` is detected at upload via magic bytes and stored in `document_files`.
> Workers do NOT check file types - the **orchestrator** decides routing based on MIME type.

> [!WARNING]
> **Token Limit Protection**: All raw text extraction workers (`txt-simple-extract`, `pdf-simple-extract`, and `format-conversion`) hard-truncate extracted text at **50,000 characters**. This prevents LLM token context explosions and API timeouts when processing extremely dense or large documents. The string `\n\n...[TRUNCATED]` is automatically appended to any truncated text.

### Subtask → Orchestrator Returns

Each subtask returns results that flow to subsequent steps or aggregation:

```typescript
// Pre-analysis result
interface PreAnalysisResult {
  isMultiDocument: boolean;
  documentCount: number;
  pageCount: number;
  hasTextLayer: boolean;
  textQuality: "good" | "poor" | "none";
  language: string;
  documents?: { type: string; pages: number[]; hint: string }[];
}

// Classification result
interface ClassificationResult {
  documentType: string; // e.g., "income.payslip"
  confidence: number; // 0-1
  language: string;
  issuerHint?: string;
  dateHint?: string;
}

// Extraction result
interface ExtractionResult {
  template: string;
  fields: Record<string, unknown>; // Type-specific fields
  rawText?: string;
}

// Image scaling result
interface ImageScalingResult {
  scaledPaths: string[];
  originalDimensions: { width: number; height: number }[];
}

// Image pre-filter result
interface ImagePrefilterResult {
  hasText: boolean;
  rawText: string;
  charCount: number;
}

// PDF extraction result
interface PdfExtractResult {
  text: string;
  pageCount: number;
  hasTextLayer: boolean;
  textQuality: "good" | "poor";
}
```

### Job Hierarchy (Reactive — Sequential Steps)

The orchestrator is a **reactive state machine**. It does NOT spawn all children upfront.
Instead, it spawns one step, suspends (`moveToWaitingChildren`), reads the result, and decides the next step.

```
process-document (orchestrator state machine)
│
├─ PDF path:
│   Initial → PreAnalysis → WaitPreAnalysis → Routing
│   Routing → (multi-doc?)  pdf-splitter → WaitExtraction → Finalize
│          → (good text?)   pdf-simple-extract → WaitExtraction → Classify
│          → (poor text?)   image-scaling → WaitExtraction → image-prefilter → WaitPreFilter
│                                                            ↓ (has text?)
│                                                         llm-ocr → WaitExtraction → Classify
│                                                            ↓ (no text)
│                                                         Finalize
│
├─ Image path:
│   Initial → image-scaling → WaitExtraction → image-prefilter → WaitPreFilter
│                                                  ↓ (has text?)
│                                               llm-ocr → WaitExtraction → Classify
│                                                  ↓ (no text)
│                                               Finalize
│
├─ Text path:
│   Initial → txt-simple-extract → WaitTextExtraction → Classify
│
├─ Office/Email path:
│   Initial → format-conversion → WaitConversion
│          → (PDF generated) → PreAnalysis → ... (PDF path)
│          → (Text extracted via Pandas) → Classify
│
├─ After Classify:
│   Classify → WaitClassify → Normalize → WaitNormalize → Finalize
│
└─ Finalize: aggregate children values → writeBackResults → Supabase RPC
```

Child jobs spawned per step:

| Step             | Spawns                  | Returns                 |
| ---------------- | ----------------------- | ----------------------- |
| PreAnalysis      | `pdf-pre-analysis`      | PreAnalysisResult       |
| Routing (split)  | `pdf-splitter`          | PdfSplitResult          |
| Routing (good)   | `pdf-simple-extract`    | PdfExtractResult        |
| Routing (poor)   | `image-scaling`         | ImageScalingResult      |
| Initial (image)  | `image-scaling`         | ImageScalingResult      |
| Initial (text)   | `txt-simple-extract`    | TxtExtractResult        |
| Initial (office) | `format-conversion`     | FormatConversionResult  |
| WaitExtraction   | `image-prefilter`       | ImagePrefilterResult    |
| WaitPreFilter    | `llm-ocr` (conditional) | LlmOcrResult            |
| Classify         | `llm-classify`          | LlmClassificationResult |
| Normalize        | `llm-normalize`         | LlmNormalizationResult  |

> [!NOTE]
> **Reactive correction**: If `image-scaling` completes but `llm-ocr` is missing in `WaitExtraction`,
> the orchestrator dynamically spawns OCR with the scaled paths. This handles the case where
> scaling and OCR need to be sequential (scaling produces the images OCR needs).

---

## Phase Overview

Each phase follows **local development first**, then **Fly.io deployment**.

| Phase | Name                      | Description                                    |
| ----- | ------------------------- | ---------------------------------------------- |
| 1     | Infrastructure            | Docker Compose, queues, secrets                |
| 2     | Orchestrator & Writebacks | FlowProducer pattern, Supabase RPC integration |
| 3     | Format Conversion         | Office Docs & Emails to PDF/Text               |
| 4     | Text Extraction           | txt-simple-extract for Markdown/CSV/TXT        |
| 5     | PDF Pre-Analysis          | Detect multi-docs, text quality                |
| 6     | PDF Splitter              | Split multi-document PDFs                      |
| 7     | PDF Simple Extract        | pdfplumber text extraction                     |
| 8     | Image Scaling             | Resize to 1024px for LLM Vision                |
| 9     | Image Pre-Filter          | Filter out images with no text (Tesseract)     |
| 10    | LLM OCR                   | LLM Vision OCR for images                      |
| 11    | LLM Classify              | Document type classification                   |
| 12    | LLM Normalize             | Structured data extraction                     |
| 13    | Cloud Sync                | _Reserved for future_                          |

---

## Phase 1: Infrastructure

### 1.1 Local Development

- [x] **Initialize `workers/` subfolder**

  ```bash
  mkdir workers && cd workers
  npm init -y
  npm install bullmq ioredis express @supabase/supabase-js sharp
  npm install -D typescript @types/node @types/express tsx
  ```

- [x] **Docker Compose** (`workers/docker-compose.yml`)

  ```yaml
  version: "3.8"
  services:
    redis:
      image: redis:7-alpine
      ports: ["6380:6379"]
      volumes: [redis_data:/data]

    worker:
      build: .
      volumes:
        - ./src:/app/src
      environment:
        - REDIS_URL=redis://redis:6379
        - SUPABASE_URL=${SUPABASE_URL}
        - SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
        - FLY_WORKER_SECRET=${FLY_WORKER_SECRET}
      depends_on: [redis]
      command: npx tsx watch src/index.ts

  volumes:
    redis_data:
  ```

- [x] **Queue definitions** (`src/queues.ts`)

  ```typescript
  import { Queue } from "bullmq";
  import IORedis from "ioredis";

  export const connection = new IORedis(process.env.REDIS_URL!);
  export const orchestratorQueue = new Queue("orchestrator", { connection });
  export const tasksQueue = new Queue("tasks", { connection });
  ```

- [ ] **Test locally**: `docker-compose up`, add test job, verify processing

### 1.2 Fly.io Deployment

- [ ] **Create Fly app**: `fly apps create docgather-workers`

- [ ] **Set secrets**:

  ```bash
  fly secrets set \
    UPSTASH_REDIS_URL=... \
    SUPABASE_URL=... \
    SUPABASE_SERVICE_ROLE_KEY=... \
    FLY_WORKER_SECRET=...
  ```

- [ ] **fly.toml configuration**:

  ```toml
  app = "docgather-workers"
  primary_region = "cdg"

  [build]
    dockerfile = "Dockerfile"

  [http_service]
    internal_port = 8080
    auto_stop_machines = "stop"
    auto_start_machines = true
    min_machines_running = 0

  [[vm]]
    size = "shared-cpu-2x"
    memory = "2gb"
  ```

- [ ] **Deploy and test**: `fly deploy && fly logs`

---

## Phase 2: Orchestrator & Write-backs

### 2.1 Local Development

- [x] **Orchestrator worker** (`src/orchestrator.ts`) — Reactive state machine

  ```typescript
  import { Worker, Job, WaitingChildrenError } from "bullmq";
  import { addJobToFlow } from "./flow-producer-wrapper.js";

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

    Finalize = "finalize",
  }

  // The processor runs a while-loop state machine.
  // Each "Wait" step calls moveToWaitingChildren → throws WaitingChildrenError.
  // BullMQ re-invokes the processor when children complete.
  export const orchestratorProcessor = async (job: Job, token?: string) => {
    let currentStep = job.data.step as Step;
    while (currentStep !== Step.Finalize) {
      switch (currentStep) {
        case Step.Initial:
          // Route by MIME type: PDF → PreAnalysis, Image → spawn scaling+OCR
          break;
        case Step.WaitExtraction:
          if (await job.moveToWaitingChildren(token!))
            throw new WaitingChildrenError();
          // Read results, decide next step reactively
          break;
        // ... (see orchestrator.ts for full implementation)
      }
    }
    // Finalize: aggregate & write-back
    const results = await job.getChildrenValues();
    await writeBackResults(job.data.documentId, results);
    return { success: true };
  };
  ```

- [x] **FlowProducer wrapper** (`src/flow-producer-wrapper.ts`)

  Abstracts `FlowProducer.add` for testability (mocked via `vi.mock` in tests):

  ```typescript
  import { FlowProducer } from "bullmq";
  import { connection } from "./queues.js";

  const flowProducer = new FlowProducer({ connection });
  export const addJobToFlow = async (args: any) => flowProducer.add(args);
  ```

- [x] **Write-back utility** (`src/supabase.ts`)

  ```typescript
  import { createClient } from "@supabase/supabase-js";

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SB_SECRET_KEY!,
  );

  export async function writeBackResults(
    documentId: string,
    results: Record<string, any>,
  ) {
    const { error } = await supabase.rpc("worker_mark_processing_complete", {
      p_document_id: documentId,
      p_classification: results["llm-classify"],
      p_extraction: results["llm-extract"],
    });
    if (error) throw error;
  }
  ```

- [x] **Test**: Mock subtasks, verify aggregation and write-back

### 2.2 Fly.io Deployment

- [ ] Deploy and test with queue-job Edge Function

---

## Phase 3: Format Conversion (Office Docs & Emails)

Convert Microsoft Office documents (.docx, .xlsx, .pptx) and emails (.eml, .msg) to PDF via LibreOffice before proceeding with standard PDF extraction. If the file is a spreadsheet, directly parse via Pandas to skip PDF steps.

### 3.1 Local Development

- [x] **Worker** (`src/workers/format-conversion.ts`)

  ```typescript
  processor: async (job) => {
    // Download original docx/xlsx decrypted
    const buffer = await downloadFile(job.data.documentId, "original");

    // Convert via libreoffice
    await execFileAsync("soffice", [
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      tempDir,
      inputFile,
    ]);

    // Upload new PDF to `converted_pdf.pdf`
    const { storage_path } = await uploadFile(
      job.data.documentId,
      "converted_pdf",
      pdfBuffer,
      "application/pdf",
    );

    return { convertedPdfPath: storage_path };
  };
  ```

- [x] **Configuration**:
  - Worker container includes `libreoffice-core` and its dependencies.

### 3.2 Fly.io Deployment

- [ ] Deploy with LibreOffice included

---

## Phase 4: Text Extraction

Extract text from simple formats like `.txt`, `.csv`, `.md`. Limits output to 50k characters.

### 4.1 Local Development

- [x] **Worker** (`src/workers/txt-simple-extract.ts`)

  ```typescript
  processor: async (job) => {
    const buffer = await downloadFile(job.data.documentId, "original");
    let text = new TextDecoder("utf-8").decode(buffer);

    if (text.length > 50000) {
      text = text.substring(0, 50000) + "\n\n...[TRUNCATED]";
    }

    return { text, success: true } satisfies TxtExtractResult;
  };
  ```

### 4.2 Fly.io Deployment

- [ ] Deploy and test with text/csv files

---

## Phase 5: PDF Pre-Analysis

Quick scan: multi-doc detection, text quality, page count.

### 5.1 Local Development

- [ ] **Worker** (`src/workers/pdf-pre-analysis.ts`)

  ```typescript
  processor: async (job) => {
    const localPath = await downloadToTemp(job.data.originalPath);
    const result = await runPythonScript("processors/python/pre_analyze.py", [
      localPath,
    ]);
    return JSON.parse(result) as PreAnalysisResult;
  };
  ```

- [ ] **Python script** (`processors/python/pre_analyze.py`)

  ```python
  import pdfplumber, json, sys

  with pdfplumber.open(sys.argv[1]) as pdf:
      text = "".join(p.extract_text() or "" for p in pdf.pages[:3])
      print(json.dumps({
          "pageCount": len(pdf.pages),
          "hasTextLayer": len(text.strip()) > 50,
          "textQuality": "good" if len(text) > 200 else "poor",
          "isMultiDocument": False,  # TODO: LLM detection
      }))
  ```

### 5.2 Fly.io Deployment

- [ ] Dockerfile includes `pdfplumber`, deploy

---

## Phase 6: PDF Splitter

Split multi-document PDFs into separate child documents.

### 6.1 Local Development

- [ ] **Worker** (`src/workers/pdf-splitter.ts`)

  ```typescript
  processor: async (job) => {
    if (!job.data.preAnalysis?.isMultiDocument) return null;

    for (const doc of job.data.preAnalysis.documents) {
      const childBuffer = await extractPages(job.data.originalPath, doc.pages);
      const childDocId = await createChildDocument(job.data.documentId, doc);
      await uploadFile(
        "documents",
        `${ownerId}/${childDocId}/original.pdf`,
        childBuffer,
      );
      await orchestratorQueue.add("process-document", {
        documentId: childDocId,
        ownerId,
      });
    }
    return { splitInto: job.data.preAnalysis.documentCount };
  };
  ```

- [ ] **PDF manipulation**: pdf-lib or qpdf for page extraction

### 6.2 Fly.io Deployment

- [ ] Deploy and test with multi-passport PDF

---

## Phase 7: PDF Simple Extract

pdfplumber text extraction for PDFs with good text layers.

### 7.1 Local Development

- [ ] **Worker** (`src/workers/pdf-simple-extract.ts`)

  ```typescript
  processor: async (job) => {
    if (job.data.preAnalysis?.textQuality !== "good") return null;

    const result = await runPythonScript("processors/python/extract_text.py", [
      localPath,
    ]);
    return JSON.parse(result) as PdfExtractResult;
  };
  ```

- [ ] **Python script**: Full pdfplumber extraction with table handling

### 7.2 Fly.io Deployment

- [ ] Deploy and test with text-heavy PDFs

---

## Phase 8: Image Scaling

Resize images to max 1024px for LLM Vision (cost optimization).

> [!IMPORTANT]
> The **orchestrator** decides which documents go to this worker based on MIME type from DB (detected via magic bytes at upload). The worker processes whatever it receives without type checking.

### 8.1 Local Development

- [x] **Worker** (`src/workers/image-scaling.ts`)

  Uses **ImageMagick** via child process for broad format support (HEIC, RAW, PSD, TIFF, etc.):

  ```typescript
  // Uses ImageMagick for broad format support
  import { execFile } from "child_process";

  processor: async (job) => {
    // Download original (decrypted via edge function)
    const buffer = await downloadFile(job.data.documentId, "original");
    await writeFile(inputFile, Buffer.from(buffer));

    // Resize with ImageMagick (>= means only if larger)
    await execFileAsync("magick", [
      inputFile,
      "-resize",
      "1024x1024>",
      "-quality",
      "85",
      outputFile, // .webp
    ]);

    // Upload scaled image (encrypted via edge function)
    // Edge function handles encryption and creating the document_files entry
    const scaledBuffer = await readFile(outputFile);
    const { storage_path } = await uploadFile(
      job.data.documentId,
      "llm_optimized",
      scaledBuffer,
      "image/webp",
    );

    return { scaledPaths: [storage_path] } satisfies ImageScalingResult;
  };
  ```

- [x] **Test**: Mock execFile and supabase, verify resize, upload, and document_files entry

### 8.2 Fly.io Deployment

- [ ] Deploy and test with production storage

---

---

## Phase 9: Image Pre-Filter

Filter out images containing little to no text (e.g., blank pages, photos of objects) to save LLM Vision costs.

### 9.1 Local Development

- [x] **Worker** (`src/workers/image-prefilter.ts`)

  Uses **Tesseract OCR** via child process:

  ```typescript
  processor: async (job) => {
    // Download scaled image
    const { text } = await runTesseract(job.data.scaledImagePaths[0]);

    return {
      hasText: text.length > 0,
      rawText: text,
      charCount: text.length,
    } satisfies ImagePrefilterResult;
  };
  ```

- [x] **Configuration**:
  - Worker container needs `tesseract-ocr` and language packs (`tesseract-ocr-data-eng`, `tesseract-ocr-data-fra`).

### 9.2 Fly.io Deployment

- [ ] Deploy with updated Dockerfile

---

## Phase 10: LLM OCR (Vision-Based Text Extraction)

For images/scanned PDFs without text layer. Uses LLM Vision to extract text.

### 10.1 Local Development

- [x] **LLM Provider Abstraction** (`src/llm/`)

  | File             | Description                                                      |
  | ---------------- | ---------------------------------------------------------------- |
  | `types.ts`       | Configs for `text`, `vision`, `ocr` models & Provider interfaces |
  | `generic.ts`     | OpenAI-compatible provider with multimodal capabilities          |
  | `mistral-ocr.ts` | Specialized Mistral OCR API provider                             |
  | `ollama.ts`      | Local Ollama for development testing                             |
  | `cache.ts`       | Disk cache based on `{systemPrompt, userPrompt, imageBuffer}`    |
  | `index.ts`       | Unified LLMClient with dedicated `.ocr`, `.vision`, `.text`      |

- [x] **Worker** (`src/workers/llm-ocr.ts`)

  ```typescript
  processor: async (job) => {
    const imageBase64 = await downloadAsBase64(job.data.scaledImagePaths);

    const client = new LLMClient();
    const response = await client.ocr(SYSTEM_PROMPT, imageBase64, "image/webp");
    return response satisfies LlmOcrResult;
  };
  ```

- [x] **Configuration** (`.env.example`)

  ```bash
  # Provider: "ovhcloud" (default) or "ollama"
  LLM_PROVIDER=ovhcloud

  # OVHcloud AI Endpoints
  OVH_AI_API_KEY=your_key
  LLM_ENDPOINT=https://qwen2-5-vl-72b-instruct.endpoints.kepler.ai.cloud.ovh.net/api/openai_compat/v1
  LLM_MODEL=Qwen2.5-VL-72B-Instruct

  # Local Ollama (for testing)
  # LLM_PROVIDER=ollama
  # LLM_ENDPOINT=http://localhost:11434
  # LLM_MODEL=llava:13b

  # Optional: Cache LLM responses (saves API costs)
  LLM_CACHE_ENABLED=true
  LLM_CACHE_DIR=/app/cache  # Docker mount: ./cache:/app/cache
  ```

- [x] **Test**: Mock LLM client, verify text extraction flow

### 10.2 Fly.io Deployment

- [ ] Add `OVH_AI_API_KEY` to Fly.io secrets
- [ ] Test with production images

---

## Phase 11: LLM Classify

Document type classification.

### 11.1 Local Development

- [ ] **Worker** (`src/workers/llm-classify.ts`)

  ```typescript
  processor: async (job) => {
    const useVision =
      !job.data.extractedText || job.data.preAnalysis?.textQuality !== "good";

    const result = useVision
      ? await classifyWithVision(job.data.scaledImagePaths)
      : await classifyWithText(job.data.extractedText);

    return result as ClassificationResult;
  };
  ```

- [ ] **Prompts**: Document taxonomy, confidence scoring

### 11.2 Fly.io Deployment

- [ ] Deploy and test with various document types

---

## Phase 12: LLM Normalize

Structured data extraction based on classification and schema validation.

### 12.1 Local Development

- [ ] **Worker** (`src/workers/llm-normalize.ts`)

  ```typescript
  processor: async (job) => {
    const { documentId, extractedText, classification, extractionMethod } =
      job.data;
    const schema = getExtractionSchema(classification.documentType);
    const client = new LLMClient();

    let result;
    // Multimodal Fallback: If OCR text wasn't great and confidence is low
    if (
      extractionMethod === "vision" &&
      classification.extractionConfidence < 0.8
    ) {
      const imageBuffer = await downloadFile(documentId, "llm_optimized");
      result = await client.vision(systemPrompt, imageBuffer, "image/webp", {
        userPrompt: extractedText,
      });
    } else {
      result = await client.chat(systemPrompt, extractedText);
    }

    return result as LlmNormalizationResult;
  };
  ```

- [ ] **Schemas**: Per document type (payslip, passport, utility bill, etc.)

### 12.2 Fly.io Deployment

- [ ] Deploy and test with real documents

---

## Phase 13: Cloud Sync (Future)

> [!NOTE]
> **Reserved for future implementation.** Will include:
>
> - OAuth token management (Google Drive, OneDrive, Dropbox)
> - Change detection algorithms
> - Rate limiting and cooldowns
> - Incremental sync

---

## Processing Tools

### Dockerfile (Multi-Stage)

`workers/Dockerfile`:

```dockerfile
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    poppler-utils \
    libreoffice-core libreoffice-writer libreoffice-calc \
    libvips42 \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

RUN pip install --no-cache-dir \
    pdfplumber pillow pillow-heif pdf2image \
    python-docx openpyxl extract-msg beautifulsoup4

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .

EXPOSE 8080
CMD ["node", "dist/index.js"]
```

### Tool Dependencies

| Tool                     | Purpose                               |
| ------------------------ | ------------------------------------- |
| `pdfplumber`             | PDF text extraction (best for tables) |
| `pillow` + `pillow-heif` | Image manipulation, HEIC support      |
| `pdf2image` + poppler    | PDF → images for vision               |
| `python-docx`            | DOCX extraction                       |
| `openpyxl`               | XLSX extraction                       |
| `LibreOffice` (headless) | Legacy Office → PDF conversion        |
| `extract-msg`            | Outlook MSG parsing                   |
| `beautifulsoup4`         | HTML parsing                          |

> [!NOTE]
> **Tesseract deliberately omitted**: LLM Vision handles OCR better for our document types.

### TypeScript ↔ Python Bridge

```typescript
// src/processors/python.ts
import { spawn } from "child_process";

export function runPythonScript(
  script: string,
  args: string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [script, ...args]);
    let stdout = "",
      stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(stderr)),
    );
  });
}
```

---

## Background Jobs & Retry

### Retry Mechanism

| Trigger        | Condition                        | Action                         |
| -------------- | -------------------------------- | ------------------------------ |
| New deployment | `error_worker_version` ≠ current | Re-queue with `source='retry'` |
| Daily fallback | `last_retry_at` > 24h ago        | Re-queue (max 3 per version)   |
| Manual         | Admin action                     | Call `queue-job` endpoint      |

### LLM Parse Retry

Sometimes LLMs don't follow instructions and return a response not following the schema.

LLM workers (`llm-ocr`, `llm-classify`, `llm-normalize`) include an **in-worker parse retry loop**: if JSON parsing or Zod schema validation fails, the worker retries the LLM call up to **3 times** with `skipCache: true` to force a fresh response. If all attempts fail:

- `llm-ocr` → throws (job fails, handled by BullMQ retry)
- `llm-classify` → returns `other.unclassified` fallback
- `llm-normalize` → returns `null`

### Worker Health Endpoint

```typescript
app.get("/health", (req, res) => {
  res.json({ version: process.env.FLY_MACHINE_VERSION, status: "healthy" });
});
```

---

## Subtleties & Gotchas

> [!CAUTION]
> **Worker service key scope**
> Must be tightly scoped. Never give workers access to auth tables.

> [!WARNING]
> **Fly.io cold starts**
> First request after scale-to-zero may take 1-3s. Use HTTP waker for predictable latency.

> [!IMPORTANT]
> **EU region for GDPR**
> Fly.io workers MUST run in EU region (`cdg` Paris preferred).

> [!NOTE]
> **Thumbnail stylization**
> Start with Gaussian blur (simple). Delaunay triangulation is distinctive but expensive.
