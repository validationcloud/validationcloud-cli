import { describe, expect, it } from "vitest";
import { decodeJwtClaims } from "./decode-jwt-claims.ts";

const none = { sub: undefined, exp: undefined };

describe("decodeJwtClaims", () => {
  it.each([
    [
      "sub and exp",
      "h.eyJzdWIiOiJ1c2VyLTEiLCJleHAiOjE3MDAwMDAwMDB9.s",
      { sub: "user-1", exp: 1_700_000_000 },
    ],
    [
      "unpadded base64url without exp",
      "h.eyJzdWIiOiJ1c2VyLTEifQ.s",
      { sub: "user-1", exp: undefined },
    ],
    ["non-ASCII subject", "h.eyJzdWIiOiLDvOKCrCIsImV4cCI6MX0.s", { sub: "ü€", exp: 1 }],
    ["claims of the wrong type", "h.eyJleHAiOiJzb29uIiwic3ViIjo1fQ.s", none],
    ["an array payload", "h.WzFd.s", none],
    ["a null payload", "h.bnVsbA.s", none],
    ["a non-JSON payload", "h.!!!.s", none],
    ["too few segments", "h.eyJzdWIiOiJ1c2VyLTEifQ", none],
    ["too many segments", "h.eyJzdWIiOiJ1c2VyLTEifQ.s.extra", none],
    ["an opaque token", "opaque-token", none],
    ["an empty string", "", none],
  ])("decodes %s", (_label, token, expected) => {
    expect(decodeJwtClaims(token)).toStrictEqual(expected);
  });
});
