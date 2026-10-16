import { describe, expect, it } from "vitest";
import { resolveRequestTimeouts } from "./resolve-request-timeouts.ts";

describe("resolveRequestTimeouts", () => {
  it.each([undefined, ""])(
    "defaults to 60 s, 330 s for tool calls and 20 s for a refresh for %j",
    (raw) => {
      expect(resolveRequestTimeouts(raw)).toStrictEqual({
        ok: true,
        value: { setupMs: 60_000, toolCallMs: 330_000, refreshMs: 20_000 },
      });
    },
  );

  it.each([
    ["1500", 1500],
    ["600000", 600_000],
    ["2147483647", 2_147_483_647],
  ])("replaces every default with %j", (raw, milliseconds) => {
    expect(resolveRequestTimeouts(raw)).toStrictEqual({
      ok: true,
      value: { setupMs: milliseconds, toolCallMs: milliseconds, refreshMs: milliseconds },
    });
  });

  it.each(["0", "-5", "1.5", "60s", "abc", " 100", "2147483648"])("rejects %j", (raw) => {
    expect(resolveRequestTimeouts(raw)).toStrictEqual({
      ok: false,
      error:
        "VC_REQUEST_TIMEOUT_MS must be a whole number of milliseconds between 1 and 2147483647",
    });
  });
});
