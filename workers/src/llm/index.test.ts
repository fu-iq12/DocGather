import { describe, it, expect, vi } from "vitest";
import { parseResponse } from "./index.js";
import { z } from "zod";

describe("LLMClient.parseResponse", () => {
  const testSchema = z.object({
    hello: z.string(),
  });

  it("should parse valid JSON", () => {
    const content = '{"hello": "world"}';
    const result = parseResponse(content, "prompt", testSchema);
    expect(result).toEqual({ hello: "world" });
  });

  it("should extract JSON from markdown block", () => {
    const content = '```json\n{"hello": "markdown"}\n```';
    const result = parseResponse(content, "prompt", testSchema);
    expect(result).toEqual({ hello: "markdown" });
  });

  it("should trace json_parse_error and throw when JSON is invalid", () => {
    const content = "Invalid JSON";
    const mockTrace = {
      startObservation: vi.fn(() => mockTrace),
      endObservation: vi.fn(() => mockTrace),
    };

    expect(() =>
      parseResponse(content, "my-prompt", testSchema, mockTrace),
    ).toThrow();
    expect(mockTrace.startObservation).toHaveBeenCalledWith(
      "json_parse_error",
      expect.objectContaining({
        input: { prompt: "my-prompt", rawResponse: content },
        level: "ERROR",
      }),
      expect.objectContaining({
        asType: "span",
      }),
    );
  });

  it("should trace zod_validation_error and throw when schema fails", () => {
    const content = '{"wrong": "field"}';
    const mockTrace = {
      startObservation: vi.fn(() => mockTrace),
      endObservation: vi.fn(() => mockTrace),
    };

    expect(() =>
      parseResponse(content, "my-prompt", testSchema, mockTrace),
    ).toThrow();
    expect(mockTrace.startObservation).toHaveBeenCalledWith(
      "zod_validation_error",
      expect.objectContaining({
        input: { prompt: "my-prompt", parsedResponse: { wrong: "field" } },
        level: "ERROR",
      }),
      expect.objectContaining({
        asType: "span",
      }),
    );
  });
});
