/**
 * Message Types for Worker Communication
 *
 * Defines the contracts between orchestrator and subtask workers.
 */

// ============================================================================
// Orchestrator → Subtask Input
// ============================================================================

export interface SubtaskInput {
  documentId: string;
  ownerId: string;
  /** MIME type from document_files (detected via magic bytes at upload) */
  mimeType: string;
  /** ID of the original file in document_files */
  originalFileId: string;
  /** Storage path to original file */
  originalPath: string;
  /** Current step in the orchestration flow (for reactive jobs) */
  step?: number;
  /** Storage paths to scaled page images */
  scaledImagePaths?: string[];
  /** Storage path to converted PDF (for Office documents) */
  convertedPdfPath?: string;
  /** Extracted text (convenience shorthand derived from ocrResult or pdfExtractResult) */
  extractedText?: string;
  /** Results from pre-analysis step */
  preAnalysis?: PreAnalysisResult;
  /** Results from classification step */
  classification?: LlmClassificationResult;
  /** Flag to indicate if the document was split and parent processing stopped */
  splitCompleted?: boolean;
  /** Source of the job (upload, sync, etc) */
  source?: JobSource;
  /** Original filename of the document */
  originalFilename?: string;
  /** Method used to extract text: 'vision' (OCR) or 'pdf' (native extract) */
  extractionMethod?: "vision" | "pdf";
}

// ============================================================================
// Subtask → Orchestrator Returns
// ============================================================================

export interface PreAnalysisResult {
  isMultiDocument: boolean;
  documentCount: number;
  pageCount: number;
  hasTextLayer: boolean;
  textQuality: "best" | "good" | "poor" | "none";
  language: string;
  /** Detected document boundaries (if multi-document) */
  documents?: Array<{
    type: string;
    pages: number[];
    hint?: string;
    image_cover?: number;
  }>;
}

export interface LlmClassificationResult {
  /** Document type, e.g., "income.payslip" */
  documentType: string;
  /** Extraction confidence score 0-1 */
  extractionConfidence: number;
  /** Detected language */
  language: string;
  /** Hint about the issuer */
  issuerHint?: string;
  /** Hint about the document date */
  dateHint?: string;
  /** Explanation for classification */
  explanation?: string;
  /** A short summary of the document */
  documentSummary?: string;
}

export interface ExtractionResult {
  /** Document type template used */
  template: string;
  /** Extracted fields (type-specific) */
  fields: Record<string, unknown>;
  /** Raw extracted text */
  rawText?: string;
}

export interface ImageScalingResult {
  /** Storage paths to scaled images */
  scaledPaths: string[];
  /** Original dimensions before scaling */
  originalDimensions: Array<{
    width: number;
    height: number;
  }>;
}

export interface PdfExtractResult {
  /** Extracted text content */
  text: string;
  /** Number of pages in PDF */
  pageCount: number;
  /** Whether PDF has a text layer */
  hasTextLayer: boolean;
  /** Quality of extracted text */
  textQuality: "good" | "poor";
}

export interface PdfSplitResult {
  /** Number of child documents created */
  splitInto: number;
  /** IDs of created child documents */
  childDocumentIds: string[];
}

export interface LlmOcrResult {
  /** Extracted text as flat string */
  rawText: string;
  /** Structured field data if document has clear fields */
  structuredData: Record<string, unknown> | null;
  /** Document description */
  documentDescription?: string;
  /** Detected language */
  language?: string | string[];
  /** Number of pages/images processed */
  pageCount: number;
  /** Provider info */
  extractedBy: string;
  model: string;
  cached: boolean;
}

export interface ImagePrefilterResult {
  /** Whether the image contains detectable text */
  hasText: boolean;
  /** Raw OCR text from Tesseract (for debugging) */
  rawText: string;
  /** Character count of detected text */
  charCount: number;
}

export interface TxtExtractResult {
  /** Extracted raw text content */
  text: string;
  /** Whether the text was successfully decoded */
  success: boolean;
}

export interface FormatConversionResult {
  /** Storage path to the converted PDF */
  convertedPdfPath?: string;
  /** Extracted markdown text directly from spreadsheets */
  extractedText?: string;
}

export type LlmNormalizationResult = ExtractionResult;

// ...

export interface ProcessingResults {
  preAnalysis?: PreAnalysisResult;
  imageScaling?: ImageScalingResult;
  imagePrefilter?: ImagePrefilterResult;
  pdfExtract?: PdfExtractResult;
  txtExtract?: TxtExtractResult;
  ocrExtract?: LlmOcrResult;
  classification?: LlmClassificationResult;
  normalized?: LlmNormalizationResult;

  pdfSplit?: PdfSplitResult;
  formatConversion?: FormatConversionResult;
}

// ============================================================================
// Job Priority
// ============================================================================

export type JobSource = "user_upload" | "cloud_sync" | "retry";

export const JOB_PRIORITY: Record<JobSource, number> = {
  user_upload: 1, // Highest - user is waiting
  cloud_sync: 5, // Medium - background sync
  retry: 10, // Lowest - failed job retry
};
