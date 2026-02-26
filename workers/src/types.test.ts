/**
 * Validation Suite: types
 * Tests the types module for expected architectural behaviors and edge cases.
 */

import { describe, it, expect } from "vitest";
import { JOB_PRIORITY } from "./types.js";
import type {
  SubtaskInput,
  PreAnalysisResult,
  ProcessingResults,
} from "./types.js";

describe("types", () => {
  describe("JOB_PRIORITY", () => {
    it("should have user_upload as highest priority (lowest number)", () => {
      expect(JOB_PRIORITY.user_upload).toBe(1);
    });

    it("should have cloud_sync as medium priority", () => {
      expect(JOB_PRIORITY.cloud_sync).toBe(5);
    });

    it("should have retry as lowest priority (highest number)", () => {
      expect(JOB_PRIORITY.retry).toBe(10);
    });

    it("should maintain priority ordering", () => {
      expect(JOB_PRIORITY.user_upload).toBeLessThan(JOB_PRIORITY.cloud_sync);
      expect(JOB_PRIORITY.cloud_sync).toBeLessThan(JOB_PRIORITY.retry);
    });
  });

  describe("SubtaskInput", () => {
    it("should require mimeType, originalFileId, and originalPath", () => {
      const input: SubtaskInput = {
        documentId: "doc-123",
        ownerId: "user-456",
        mimeType: "image/jpeg",
        originalFileId: "file-789",
        originalPath: "/path/to/file.jpg",
      };

      expect(input.documentId).toBe("doc-123");
      expect(input.ownerId).toBe("user-456");
      expect(input.mimeType).toBe("image/jpeg");
      expect(input.originalFileId).toBe("file-789");
      expect(input.originalPath).toBe("/path/to/file.jpg");
    });

    it("should allow full input with all optional fields", () => {
      const input: SubtaskInput = {
        documentId: "doc-123",
        ownerId: "user-456",
        mimeType: "application/pdf",
        originalFileId: "file-789",
        originalPath: "/path/to/file.pdf",
        convertedPdfPath: "/path/to/converted.pdf",
        scaledImagePaths: ["/path/to/page1.webp", "/path/to/page2.webp"],
        extractedText: "Sample text content",
        preAnalysis: {
          isMultiDocument: false,
          documentCount: 1,
          pageCount: 3,
          hasTextLayer: true,
          textQuality: "good",
          language: "fr",
        },
        classification: {
          documentType: "income.payslip",
          extractionConfidence: 0.95,
          language: "fr",
        },
      };

      expect(input.mimeType).toBe("application/pdf");
      expect(input.preAnalysis?.hasTextLayer).toBe(true);
      expect(input.classification?.documentType).toBe("income.payslip");
    });
  });

  describe("PreAnalysisResult", () => {
    it("should support multi-document detection", () => {
      const result: PreAnalysisResult = {
        isMultiDocument: true,
        documentCount: 3,
        pageCount: 9,
        hasTextLayer: true,
        textQuality: "good",
        language: "fr",
        documents: [
          { type: "identity.passport", pages: [1, 2], hint: "French passport" },
          { type: "income.payslip", pages: [3, 4, 5], hint: "January payslip" },
          {
            type: "income.payslip",
            pages: [6, 7, 8, 9],
            hint: "February payslip",
          },
        ],
      };

      expect(result.isMultiDocument).toBe(true);
      expect(result.documents).toHaveLength(3);
      expect(result.documents![0].type).toBe("identity.passport");
    });

    it("should support text quality levels", () => {
      const good: PreAnalysisResult = {
        isMultiDocument: false,
        documentCount: 1,
        pageCount: 1,
        hasTextLayer: true,
        textQuality: "good",
        language: "en",
      };

      const poor: PreAnalysisResult = {
        ...good,
        textQuality: "poor",
      };

      const none: PreAnalysisResult = {
        ...good,
        hasTextLayer: false,
        textQuality: "none",
      };

      expect(good.textQuality).toBe("good");
      expect(poor.textQuality).toBe("poor");
      expect(none.textQuality).toBe("none");
    });
  });

  describe("ProcessingResults", () => {
    it("should allow partial results", () => {
      const results: ProcessingResults = {
        classification: {
          documentType: "income.payslip",
          extractionConfidence: 0.92,
          language: "fr",
        },
      };

      expect(results.classification?.documentType).toBe("income.payslip");

      expect(results.pdfExtract).toBeUndefined();
    });

    it("should allow complete results", () => {
      const results: ProcessingResults = {
        preAnalysis: {
          isMultiDocument: false,
          documentCount: 1,
          pageCount: 2,
          hasTextLayer: true,
          textQuality: "good",
          language: "fr",
        },
        imageScaling: {
          scaledPaths: ["/scaled/page1.webp"],
          originalDimensions: [{ width: 2480, height: 3508 }],
        },
        pdfExtract: {
          text: "Sample extracted text",
          pageCount: 2,
          hasTextLayer: true,
          textQuality: "good",
        },
        classification: {
          documentType: "income.payslip",
          extractionConfidence: 0.95,
          language: "fr",
          issuerHint: "ACME Corp",
          dateHint: "2024-01",
        },
        normalized: {
          template: "income.payslip.v1",
          fields: {
            employer: "ACME Corp",
            netSalary: 2500.0,
            period: "2024-01",
          },
        },
      };

      expect(results.preAnalysis?.pageCount).toBe(2);
      expect(results.classification?.extractionConfidence).toBe(0.95);
      expect(results.normalized?.fields).toHaveProperty("employer");
    });
  });
});

