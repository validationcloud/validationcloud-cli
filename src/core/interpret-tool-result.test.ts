import { describe, expect, it } from "vitest";
import {
  interpretToolResult,
  joinTextBlocks,
  parseTextAsJson,
  parseToolError,
} from "./interpret-tool-result.ts";

describe("joinTextBlocks", () => {
  it("joins text blocks with newlines and ignores other blocks", () => {
    expect(
      joinTextBlocks([
        { type: "text", text: "one" },
        { type: "image" },
        { type: "text" },
        { type: "text", text: "two" },
      ]),
    ).toBe("one\ntwo");
  });

  it("returns an empty string for missing content", () => {
    expect(joinTextBlocks(undefined)).toBe("");
  });
});

describe("parseToolError", () => {
  it("reads code, message and retry_after_seconds from JSON text", () => {
    expect(
      parseToolError('{"code":"rate_limited","message":"Slow down","retry_after_seconds":30}'),
    ).toStrictEqual({ code: "rate_limited", message: "Slow down", retryAfterSeconds: 30 });
  });

  it("accepts JSON with only a message", () => {
    expect(parseToolError('{"message":"Nope"}')).toStrictEqual({
      code: undefined,
      message: "Nope",
      retryAfterSeconds: undefined,
    });
  });

  it("ignores code and retry fields of the wrong type", () => {
    expect(parseToolError('{"code":7,"message":"Nope","retry_after_seconds":"5"}')).toStrictEqual({
      code: undefined,
      message: "Nope",
      retryAfterSeconds: undefined,
    });
  });

  it.each(["Plain text failure", '{"code":"x"}', '{"message":42}', "[1,2]", "null", "42", ""])(
    "uses %j verbatim as the message",
    (text) => {
      expect(parseToolError(text)).toStrictEqual({
        code: undefined,
        message: text,
        retryAfterSeconds: undefined,
      });
    },
  );
});

describe("interpretToolResult", () => {
  it("prefers structuredContent over text", () => {
    expect(
      interpretToolResult({
        content: [{ type: "text", text: '{"a":1}' }],
        structuredContent: { a: 1 },
      }),
    ).toStrictEqual({ kind: "structured", value: { a: 1 } });
  });

  it("keeps falsy structuredContent values", () => {
    expect(interpretToolResult({ structuredContent: null })).toStrictEqual({
      kind: "structured",
      value: null,
    });
  });

  it("returns joined text when there is no structuredContent", () => {
    expect(
      interpretToolResult({
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      }),
    ).toStrictEqual({ kind: "text", text: "a\nb" });
  });

  it.each([{}, { content: [] }, { content: [{ type: "image" }] }])(
    "returns empty for %j",
    (result) => {
      expect(interpretToolResult(result)).toStrictEqual({ kind: "empty" });
    },
  );

  it("parses a JSON error body into a failure", () => {
    expect(
      interpretToolResult({
        isError: true,
        content: [
          {
            type: "text",
            text: '{"code":"unauthorized","message":"Bad key","retry_after_seconds":5}',
          },
        ],
      }),
    ).toStrictEqual({
      kind: "failure",
      failure: { code: "unauthorized", message: "Bad key", retryAfterSeconds: 5 },
    });
  });

  it("uses plain error text as the message", () => {
    expect(
      interpretToolResult({ isError: true, content: [{ type: "text", text: "Gateway timeout" }] }),
    ).toStrictEqual({
      kind: "failure",
      failure: { code: undefined, message: "Gateway timeout", retryAfterSeconds: undefined },
    });
  });

  it("reports a generic message for an error without text, ignoring structuredContent", () => {
    expect(interpretToolResult({ isError: true, structuredContent: { a: 1 } })).toStrictEqual({
      kind: "failure",
      failure: { code: undefined, message: "tool call failed", retryAfterSeconds: undefined },
    });
  });
});

describe("parseTextAsJson", () => {
  it.each([
    ['{"a":1}', { a: 1 }],
    ["[1,2]", [1, 2]],
    ["42", 42],
    ["not json", "not json"],
    ["", ""],
  ])("parses %j", (text, expected) => {
    expect(parseTextAsJson(text)).toStrictEqual(expected);
  });
});
