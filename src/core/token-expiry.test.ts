import { describe, expect, it } from "vitest";
import { isExpired, resolveTokenExpiry } from "./token-expiry.ts";

// Payload {"sub":"user-1","exp":1700000000}
const JWT_WITH_EXP = "h.eyJzdWIiOiJ1c2VyLTEiLCJleHAiOjE3MDAwMDAwMDB9.s";
// Payload {"sub":"user-1"}
const JWT_WITHOUT_EXP = "h.eyJzdWIiOiJ1c2VyLTEifQ.s";

describe("resolveTokenExpiry", () => {
  it("uses the exp claim in milliseconds, ignoring saved timing", () => {
    expect(
      resolveTokenExpiry({ accessToken: JWT_WITH_EXP, savedAtMs: 5, expiresInSeconds: 60 }),
    ).toBe(1_700_000_000_000);
  });

  it("falls back to savedAt plus expires_in for a token without exp", () => {
    expect(
      resolveTokenExpiry({
        accessToken: JWT_WITHOUT_EXP,
        savedAtMs: 1_000_000,
        expiresInSeconds: 3600,
      }),
    ).toBe(4_600_000);
  });

  it("falls back for an opaque token", () => {
    expect(
      resolveTokenExpiry({ accessToken: "opaque", savedAtMs: 1000, expiresInSeconds: 1 }),
    ).toBe(2000);
  });

  it.each([
    [undefined, 60],
    [1000, undefined],
    [undefined, undefined],
  ])("is unknown without exp when savedAt=%j and expiresIn=%j", (savedAtMs, expiresInSeconds) => {
    expect(
      resolveTokenExpiry({ accessToken: "opaque", savedAtMs, expiresInSeconds }),
    ).toBeUndefined();
  });
});

describe("isExpired", () => {
  it.each([
    [undefined, 1_000_000, false],
    [100_000, 69_999, false],
    [100_000, 70_000, true],
    [100_000, 70_001, true],
    [100_000, 100_001, true],
    [100_000, 0, false],
    [20_000, 0, true],
  ])("expiry %j at now %j -> %j (30s skew)", (expiryMs, nowMs, expected) => {
    expect(isExpired(expiryMs, nowMs)).toBe(expected);
  });
});
