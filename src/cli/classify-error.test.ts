import { OAuthError, ProtocolError } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { AuthRequiredError } from "#auth/auth-required-error";
import { CredentialsFileError } from "#auth/credentials-file-error";
import { RefreshFailedError } from "#auth/refresh-failed-error";
import { classifyError } from "./classify-error.ts";

describe("classifyError", () => {
  it("recognizes a missing session", () => {
    expect(classifyError(new AuthRequiredError())).toStrictEqual({ kind: "login-required" });
  });

  it("treats a failed refresh as a refresh that is unavailable, not as a rejection", () => {
    expect(classifyError(new RefreshFailedError())).toStrictEqual({
      kind: "refresh-unavailable",
      detail: "the authorization server or the network failed",
    });
  });

  it("passes the OAuth error code through for the core to judge", () => {
    expect(classifyError(new OAuthError("invalid_grant", "Refresh token reused"))).toStrictEqual({
      kind: "oauth",
      code: "invalid_grant",
    });
  });

  it("keeps the JSON-RPC code of a protocol error", () => {
    expect(classifyError(new ProtocolError(-32_602, "Tool x not found"))).toStrictEqual({
      kind: "protocol",
      rpcCode: -32_602,
      message: "Tool x not found",
    });
  });

  it("reports a corrupt credentials file by its fixed message", () => {
    expect(classifyError(new CredentialsFileError("/tmp/credentials.json"))).toStrictEqual({
      kind: "other",
      message:
        "credentials file /tmp/credentials.json is unreadable or corrupt; run 'valcloud auth logout' or delete the file, then log in again",
    });
  });

  it("describes the cause chain of a network failure", () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), {
      code: "ECONNREFUSED",
    });
    const failure = new TypeError("fetch failed", { cause: refused });

    expect(classifyError(failure)).toStrictEqual({
      kind: "unclassified",
      chain: [
        { message: "fetch failed", code: undefined, isFetchFailure: true },
        {
          message: "connect ECONNREFUSED 127.0.0.1:1",
          code: "ECONNREFUSED",
          isFetchFailure: false,
        },
      ],
      isSdkError: false,
    });
  });

  it("stringifies a thrown non-error", () => {
    expect(classifyError("boom")).toStrictEqual({ kind: "other", message: "boom" });
  });
});
