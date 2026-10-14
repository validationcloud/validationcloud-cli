import { describe, expect, it } from "vitest";
import { exitCodeFor, renderExitCodeHelp } from "./exit-codes.ts";

describe("exitCodeFor", () => {
  it.each([
    ["tool", 1],
    ["runtime", 1],
    ["usage", 2],
    ["auth", 3],
  ] as const)("maps %s failures to exit code %i", (kind, code) => {
    expect(exitCodeFor(kind)).toBe(code);
  });
});

describe("renderExitCodeHelp", () => {
  it("lists every exit code with its meaning", () => {
    expect(renderExitCodeHelp()).toBe(`  0  success
  1  tool or runtime error (the tool reported an error, network failure)
  2  usage error (bad flags or arguments, destructive call without --yes)
  3  authentication required or failed`);
  });
});
