import { afterEach, describe, expect, it, vi } from "vitest";
import { withSdkConsoleCaptured } from "./capture-sdk-console.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("withSdkConsoleCaptured", () => {
  it("suppresses console output while the function runs and counts it", async () => {
    const warn = vi.spyOn(console, "warn").mockReturnValue(undefined);
    const error = vi.spyOn(console, "error").mockReturnValue(undefined);
    const log = vi.spyOn(console, "log").mockReturnValue(undefined);
    const info = vi.spyOn(console, "info").mockReturnValue(undefined);
    const run = await withSdkConsoleCaptured(() => {
      console.warn('[mcp-sdk] Raw body: {"refresh_token":"rt-secret"}');
      console.error("error");
      console.log("log");
      console.info("info");
      return Promise.resolve("value");
    });

    expect(run).toStrictEqual({ status: "fulfilled", value: "value", suppressedCount: 4 });
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it("restores the console after the function throws", async () => {
    const warn = vi.spyOn(console, "warn").mockReturnValue(undefined);
    const failure = new Error("refresh failed");
    const run = await withSdkConsoleCaptured(() => {
      console.warn("suppressed");
      return Promise.reject(failure);
    });
    console.warn("visible");

    expect(run).toStrictEqual({ status: "rejected", reason: failure, suppressedCount: 1 });
    expect(warn.mock.calls).toStrictEqual([["visible"]]);
  });

  it("keeps the console captured until the last overlapping run ends", async () => {
    const warn = vi.spyOn(console, "warn").mockReturnValue(undefined);
    const { promise: gate, resolve: openGate } = Promise.withResolvers<undefined>();
    const outer = withSdkConsoleCaptured(async () => {
      await gate;
      console.warn("late");
    });
    const inner = await withSdkConsoleCaptured(() => {
      console.warn("early");
      return Promise.resolve(undefined);
    });
    openGate(undefined);
    const outerRun = await outer;
    console.warn("visible");

    expect(inner).toStrictEqual({ status: "fulfilled", value: undefined, suppressedCount: 1 });
    expect(outerRun).toStrictEqual({ status: "fulfilled", value: undefined, suppressedCount: 2 });
    expect(warn.mock.calls).toStrictEqual([["visible"]]);
  });
});
