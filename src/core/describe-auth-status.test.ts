import { describe, expect, it } from "vitest";
import { describeAuthStatus } from "./describe-auth-status.ts";
import type { AuthStatusInput } from "./describe-auth-status.ts";

// Payload {"sub":"user-1","exp":1700000000} -> expires 2023-11-14T22:13:20.000Z
const JWT_WITH_EXP = "h.eyJzdWIiOiJ1c2VyLTEiLCJleHAiOjE3MDAwMDAwMDB9.s";
// Payload {"sub":"user-1"}
const JWT_WITHOUT_EXP = "h.eyJzdWIiOiJ1c2VyLTEifQ.s";

const BEFORE_EXPIRY_MS = 1_699_999_000_000;
const AFTER_EXPIRY_MS = 1_700_000_001_000;

const gateway = { url: "https://mcp.validationcloud.io/mcp" };

const base: AuthStatusInput = {
  gateway,
  source: "stored",
  timing: { accessToken: JWT_WITH_EXP, savedAtMs: undefined, expiresInSeconds: undefined },
  refreshable: false,
  nowMs: BEFORE_EXPIRY_MS,
};

describe("describeAuthStatus", () => {
  it("reports a signed-in user with a valid token", () => {
    expect(describeAuthStatus(base)).toStrictEqual({
      url: "https://mcp.validationcloud.io/mcp",
      logged_in: true,
      verified: true,
      source: "stored",
      subject: "user-1",
      expires_at: "2023-11-14T22:13:20.000Z",
      expired: false,
      refreshable: false,
    });
  });

  it("reports logged out without credentials", () => {
    expect(describeAuthStatus({ ...base, source: "none", timing: undefined })).toStrictEqual({
      url: "https://mcp.validationcloud.io/mcp",
      logged_in: false,
      verified: false,
      source: "none",
      subject: null,
      expires_at: null,
      expired: null,
      refreshable: false,
    });
  });

  it("reports an expired token as logged out when it cannot be refreshed", () => {
    expect(describeAuthStatus({ ...base, nowMs: AFTER_EXPIRY_MS })).toMatchObject({
      logged_in: false,
      expired: true,
      refreshable: false,
    });
  });

  it("keeps an expired but refreshable token logged in", () => {
    expect(
      describeAuthStatus({ ...base, nowMs: AFTER_EXPIRY_MS, refreshable: true }),
    ).toMatchObject({
      logged_in: true,
      expired: true,
      refreshable: true,
    });
  });

  it("treats a token within the 30s skew as expired", () => {
    expect(describeAuthStatus({ ...base, nowMs: 1_699_999_980_000 })).toMatchObject({
      expired: true,
    });
  });

  it("reports unknown expiry for a token without exp or timing", () => {
    expect(
      describeAuthStatus({
        ...base,
        source: "VC_TOKEN",
        timing: { accessToken: JWT_WITHOUT_EXP, savedAtMs: undefined, expiresInSeconds: undefined },
      }),
    ).toMatchObject({
      logged_in: true,
      verified: false,
      source: "VC_TOKEN",
      subject: "user-1",
      expires_at: null,
      expired: null,
    });
  });

  it("derives expiry from saved timing for a token without exp", () => {
    expect(
      describeAuthStatus({
        ...base,
        timing: {
          accessToken: JWT_WITHOUT_EXP,
          savedAtMs: 1_700_000_000_000,
          expiresInSeconds: 60,
        },
        nowMs: 1_700_000_000_000,
      }),
    ).toMatchObject({ verified: true, expires_at: "2023-11-14T22:14:20.000Z", expired: false });
  });

  it("reports a null subject for an opaque token", () => {
    expect(
      describeAuthStatus({
        ...base,
        timing: { accessToken: "opaque", savedAtMs: undefined, expiresInSeconds: undefined },
      }),
    ).toMatchObject({
      logged_in: true,
      verified: false,
      subject: null,
      expires_at: null,
      expired: null,
    });
  });
});
