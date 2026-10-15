import { describe, expect, it } from "vitest";
import { failureFromTool } from "./cli-failure.ts";
import { exitCodeFor } from "./exit-codes.ts";
import { isStaleCatalogRpcCode, mapErrorFacts } from "./map-error.ts";
import type { ErrorFacts, ErrorMappingContext } from "./map-error.ts";

const stored: ErrorMappingContext = {
  usesStaticToken: false,
  gatewayUrl: "https://mcp.example.test/mcp",
};
const staticToken: ErrorMappingContext = { ...stored, usesStaticToken: true };

describe("mapErrorFacts", () => {
  it("maps HTTP 401 to exit-code-3 auth failure with the login hint", () => {
    expect(mapErrorFacts({ kind: "http-unauthorized" }, stored)).toStrictEqual({
      kind: "auth",
      code: undefined,
      message: "authentication failed (HTTP 401)",
      hint: "run 'valcloud auth login'",
      retryAfterSeconds: undefined,
      rpcCode: undefined,
    });
  });

  it("maps HTTP 401 under VC_TOKEN to the VC_TOKEN hint", () => {
    expect(mapErrorFacts({ kind: "http-unauthorized" }, staticToken)).toMatchObject({
      kind: "auth",
      message: "the gateway rejected VC_TOKEN (HTTP 401)",
      hint: "fix or unset VC_TOKEN (stored credentials are used when it is unset)",
    });
  });

  it("maps a missing session to an auth failure", () => {
    expect(mapErrorFacts({ kind: "login-required" }, stored)).toMatchObject({
      kind: "auth",
      message: "authentication failed (session expired or missing)",
    });
  });

  it.each([
    [
      "invalid_grant",
      "authentication failed (the authorization server rejected the session: invalid_grant)",
    ],
    [
      "invalid_client",
      "authentication failed (the authorization server rejected the session: invalid_client)",
    ],
  ])("maps OAuth %s to an auth failure", (code, message) => {
    expect(mapErrorFacts({ kind: "oauth", code }, stored)).toMatchObject({
      kind: "auth",
      message,
      hint: "run 'valcloud auth login'",
    });
  });

  it("maps any other OAuth error to a runtime failure with intact credentials", () => {
    expect(mapErrorFacts({ kind: "oauth", code: "server_error" }, stored)).toMatchObject({
      kind: "runtime",
      message:
        "could not refresh the session (OAuth error server_error); stored credentials are intact",
    });
  });

  it("maps a refresh that failed for a non-OAuth reason to a runtime failure with intact credentials", () => {
    expect(
      mapErrorFacts(
        { kind: "refresh-unavailable", detail: "token endpoint answered HTTP 503" },
        stored,
      ),
    ).toMatchObject({
      kind: "runtime",
      message:
        "could not refresh the session (token endpoint answered HTTP 503); stored credentials are intact",
      hint: "try again in a moment",
    });
  });

  it("maps a network failure to a runtime failure naming the gateway", () => {
    expect(mapErrorFacts({ kind: "network", detail: "ECONNREFUSED" }, stored)).toMatchObject({
      kind: "runtime",
      message: "cannot reach https://mcp.example.test/mcp (ECONNREFUSED)",
      hint: "check your network, or set VC_MCP_URL to another gateway",
    });
  });

  it("maps another HTTP status to a runtime failure", () => {
    expect(
      mapErrorFacts({ kind: "http-status", status: 502, message: "Bad Gateway" }, stored),
    ).toMatchObject({ kind: "runtime", message: "the gateway answered HTTP 502: Bad Gateway" });
  });

  it("keeps the JSON-RPC code of a protocol error", () => {
    expect(
      mapErrorFacts({ kind: "protocol", rpcCode: -32_000, message: "Server busy" }, stored),
    ).toStrictEqual({
      kind: "runtime",
      code: "protocol_error",
      message: "Server busy (JSON-RPC error -32000)",
      hint: undefined,
      retryAfterSeconds: undefined,
      rpcCode: -32_000,
    });
  });

  it.each([-32_601, -32_602])("hints at a catalog refresh for JSON-RPC code %i", (rpcCode) => {
    expect(
      mapErrorFacts({ kind: "protocol", rpcCode, message: "Unknown tool" }, stored),
    ).toMatchObject({
      kind: "runtime",
      rpcCode,
      hint: "the tool list may be out of date; run 'valcloud tools --refresh' and retry",
    });
  });

  it.each<[string, ErrorFacts, string]>([
    [
      "a fetch failure over a connection refusal",
      {
        kind: "unclassified",
        chain: [
          { message: "fetch failed", code: undefined, isFetchFailure: true },
          {
            message: "connect ECONNREFUSED 127.0.0.1:1",
            code: "ECONNREFUSED",
            isFetchFailure: false,
          },
        ],
        isSdkError: true,
      },
      "cannot reach https://mcp.example.test/mcp (ECONNREFUSED)",
    ],
    [
      "a bare network error code",
      {
        kind: "unclassified",
        chain: [{ message: "socket hang up", code: "ECONNRESET", isFetchFailure: false }],
        isSdkError: false,
      },
      "cannot reach https://mcp.example.test/mcp (ECONNRESET)",
    ],
    [
      "a fetch failure without a cause message",
      {
        kind: "unclassified",
        chain: [{ message: "fetch failed", code: undefined, isFetchFailure: true }],
        isSdkError: false,
      },
      "cannot reach https://mcp.example.test/mcp (fetch failed)",
    ],
  ])("maps %s to a network failure", (_label, facts, message) => {
    expect(mapErrorFacts(facts, stored)).toMatchObject({ kind: "runtime", message });
  });

  it.each<[string, ErrorFacts, string]>([
    [
      "an SDK error keeps only its own message",
      {
        kind: "unclassified",
        chain: [
          { message: "request timed out", code: undefined, isFetchFailure: false },
          { message: "inner detail", code: undefined, isFetchFailure: false },
        ],
        isSdkError: true,
      },
      "request timed out",
    ],
    [
      "another error appends its cause",
      {
        kind: "unclassified",
        chain: [
          { message: "could not read file", code: undefined, isFetchFailure: false },
          { message: "permission denied", code: "EACCES", isFetchFailure: false },
        ],
        isSdkError: false,
      },
      "could not read file: permission denied",
    ],
    [
      "an error without a cause keeps its message",
      {
        kind: "unclassified",
        chain: [{ message: "boom", code: undefined, isFetchFailure: false }],
        isSdkError: false,
      },
      "boom",
    ],
  ])("maps unclassified: %s", (_label, facts, message) => {
    expect(mapErrorFacts(facts, stored)).toMatchObject({ kind: "runtime", message });
  });

  it("maps anything else to a runtime failure with its message", () => {
    expect(mapErrorFacts({ kind: "other", message: "boom" }, stored)).toMatchObject({
      kind: "runtime",
      message: "boom",
    });
  });
});

describe("exit codes of mapped errors", () => {
  it.each<[string, ErrorFacts, number]>([
    ["HTTP 401", { kind: "http-unauthorized" }, 3],
    ["missing session", { kind: "login-required" }, 3],
    ["OAuth invalid_grant", { kind: "oauth", code: "invalid_grant" }, 3],
    ["OAuth invalid_client", { kind: "oauth", code: "invalid_client" }, 3],
    ["refresh 5xx", { kind: "refresh-unavailable", detail: "HTTP 503" }, 1],
    ["network failure", { kind: "network", detail: "ECONNREFUSED" }, 1],
    ["protocol error", { kind: "protocol", rpcCode: -32_602, message: "bad params" }, 1],
    ["gateway 500", { kind: "http-status", status: 500, message: "oops" }, 1],
    ["unknown error", { kind: "other", message: "boom" }, 1],
  ])("%s exits with %i", (_label, facts, expected) => {
    expect(exitCodeFor(mapErrorFacts(facts, stored).kind)).toBe(expected);
  });

  it("exits 1 for a tool result with isError", () => {
    const failure = failureFromTool(
      { code: "not_found", message: "endpoint not found", retryAfterSeconds: undefined },
      stored,
    );
    expect(exitCodeFor(failure.kind)).toBe(1);
  });
});

describe("isStaleCatalogRpcCode", () => {
  it.each([
    [-32_601, true],
    [-32_602, true],
    [-32_603, false],
    [-32_600, false],
    [0, false],
  ])("code %i -> %j", (rpcCode, expected) => {
    expect(isStaleCatalogRpcCode(rpcCode)).toBe(expected);
  });
});
