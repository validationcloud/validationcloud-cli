import { describe, expect, it } from "vitest";
import { createFailure, failureFromTool, formatFailure } from "./cli-failure.ts";
import type { CliFailure } from "./cli-failure.ts";

const base: CliFailure = {
  kind: "tool",
  code: undefined,
  message: "Boom",
  hint: undefined,
  retryAfterSeconds: undefined,
  rpcCode: undefined,
};

describe("formatFailure", () => {
  describe("human output", () => {
    it.each([
      ["message only", {}, "vcloud: Boom\n"],
      ["code prefix", { code: "rate_limited" }, "vcloud: rate_limited: Boom\n"],
      ["retry hint", { retryAfterSeconds: 30 }, "vcloud: Boom (retry after 30s)\n"],
      [
        "hint line",
        { hint: "run vcloud auth login" },
        "vcloud: Boom\nhint: run vcloud auth login\n",
      ],
      [
        "everything",
        { code: "rate_limited", retryAfterSeconds: 0, hint: "wait" },
        "vcloud: rate_limited: Boom (retry after 0s)\nhint: wait\n",
      ],
    ] as const)("%s", (_label, overrides, expected) => {
      expect(formatFailure({ ...base, ...overrides }, false)).toBe(expected);
    });
  });

  describe("JSON output", () => {
    it.each([
      ["tool", '{"error":{"code":"tool_error","message":"Boom"}}\n'],
      ["runtime", '{"error":{"code":"runtime_error","message":"Boom"}}\n'],
      ["usage", '{"error":{"code":"usage_error","message":"Boom"}}\n'],
      ["auth", '{"error":{"code":"auth_required","message":"Boom"}}\n'],
    ] as const)("defaults the code for %s failures", (kind, expected) => {
      expect(formatFailure({ ...base, kind }, true)).toBe(expected);
    });

    it("prefers the tool's own code and includes retry and hint", () => {
      expect(
        formatFailure({ ...base, code: "rate_limited", retryAfterSeconds: 30, hint: "wait" }, true),
      ).toBe(
        '{"error":{"code":"rate_limited","message":"Boom","retry_after_seconds":30,"hint":"wait"}}\n',
      );
    });

    it("includes the JSON-RPC code", () => {
      expect(
        formatFailure({ ...base, kind: "runtime", code: "protocol_error", rpcCode: -32_602 }, true),
      ).toBe('{"error":{"code":"protocol_error","message":"Boom","rpc_code":-32602}}\n');
    });

    it("escapes newlines in the message", () => {
      expect(formatFailure({ ...base, message: "a\nb" }, true)).toBe(
        '{"error":{"code":"tool_error","message":"a\\nb"}}\n',
      );
    });
  });
});

describe("failureFromTool", () => {
  it("maps an unauthorized tool error to an auth failure with the login hint", () => {
    expect(
      failureFromTool(
        { code: "unauthorized", message: "Bad key", retryAfterSeconds: undefined },
        { usesStaticToken: false },
      ),
    ).toStrictEqual({
      kind: "auth",
      code: "unauthorized",
      message: "Bad key",
      hint: "run 'vcloud auth login'",
      retryAfterSeconds: undefined,
      rpcCode: undefined,
    });
  });

  it("gives an unauthorized tool error under VC_TOKEN the VC_TOKEN hint", () => {
    expect(
      failureFromTool(
        { code: "unauthorized", message: "Bad key", retryAfterSeconds: undefined },
        { usesStaticToken: true },
      ).hint,
    ).toBe("fix or unset VC_TOKEN (stored credentials are used when it is unset)");
  });

  it("keeps other tool errors as tool failures without a hint", () => {
    expect(
      failureFromTool(
        { code: "rate_limited", message: "Slow", retryAfterSeconds: 9 },
        { usesStaticToken: false },
      ),
    ).toStrictEqual({
      kind: "tool",
      code: "rate_limited",
      message: "Slow",
      hint: undefined,
      retryAfterSeconds: 9,
      rpcCode: undefined,
    });
  });
});

describe("createFailure", () => {
  it("builds a failure without code or retry", () => {
    expect(createFailure("usage", "bad flag", "see --help")).toStrictEqual({
      kind: "usage",
      code: undefined,
      message: "bad flag",
      hint: "see --help",
      retryAfterSeconds: undefined,
      rpcCode: undefined,
    });
  });
});
