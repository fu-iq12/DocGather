import { describe, it, expect, vi, beforeEach } from "vitest";
import { uploadFile, deleteFile, listFiles } from "./mistral-files.js";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("mistral-files", () => {
  const apiKey = "test-api-key";

  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("uploadFile", () => {
    it("should upload file successfully and return id", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "file-xyz123" }),
      });

      const buffer = new ArrayBuffer(10);
      const id = await uploadFile(
        apiKey,
        buffer,
        "image/webp",
        "document-test.webp",
        "ocr",
      );

      expect(id).toBe("file-xyz123");
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.mistral.ai/v1/files");
      expect(options.method).toBe("POST");
      expect(options.headers.Authorization).toBe(`Bearer ${apiKey}`);
      expect(options.headers["Content-Type"]).toMatch(
        /^multipart\/form-data; boundary=/,
      );
      expect(options.body).toBeInstanceOf(Buffer);

      const bodyStr = options.body.toString();
      expect(bodyStr).toContain('name="purpose"');
      expect(bodyStr).toContain("ocr");
      expect(bodyStr).toContain('name="file"; filename="document-test.webp"');
      expect(bodyStr).toContain("Content-Type: image/webp");
    });

    it("should throw error on non-2xx response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 413,
        text: async () => "Payload Too Large",
      });

      const buffer = new ArrayBuffer(10);
      await expect(
        uploadFile(apiKey, buffer, "image/webp", "doc.webp", "ocr"),
      ).rejects.toThrow(/Failed to upload Mistral file: 413 Payload Too Large/);
    });
  });

  describe("deleteFile", () => {
    it("should delete file successfully", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await deleteFile(apiKey, "file-123");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.mistral.ai/v1/files/file-123",
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      );
    });

    it("should silently resolve on 404 (already deleted)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Not Found",
      });

      await expect(deleteFile(apiKey, "file-123")).resolves.toBeUndefined();
    });

    it("should throw on other errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      await expect(deleteFile(apiKey, "file-123")).rejects.toThrow(
        /500 Internal Server Error/,
      );
    });
  });

  describe("listFiles", () => {
    const mockFiles = [
      {
        id: "file-1",
        filename: "document-00000000-0000-0000-0000-000000000000.webp",
        created_at: 1000,
      },
      { id: "file-2", filename: "2.webp", created_at: 2000 },
    ];

    it("should list all files when no purpose is provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockFiles }),
      });

      const result = await listFiles(apiKey);

      expect(result).toEqual(mockFiles);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.mistral.ai/v1/files",
        {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      );
    });

    it("should append purpose parameter to URL if provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockFiles }),
      });

      const result = await listFiles(apiKey, "ocr");

      expect(result).toEqual(mockFiles);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.mistral.ai/v1/files?purpose=ocr",
        {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      );
    });

    it("should throw on error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      await expect(listFiles(apiKey)).rejects.toThrow(/401 Unauthorized/);
    });
  });
});
