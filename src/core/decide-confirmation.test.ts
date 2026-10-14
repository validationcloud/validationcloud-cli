import { describe, expect, it } from "vitest";
import {
  decideConfirmation,
  describeRefusal,
  isAffirmative,
  isCiEnvironment,
} from "./decide-confirmation.ts";
import type { ConfirmationInput } from "./decide-confirmation.ts";

const base: ConfirmationInput = {
  destructive: true,
  yes: false,
  dryRun: false,
  noInteractive: false,
  ci: false,
  stdinConsumed: false,
  stdinIsTty: true,
};

describe("decideConfirmation", () => {
  it.each([
    [
      "non-destructive tool",
      { destructive: false, stdinIsTty: false, ci: true },
      { kind: "proceed" },
    ],
    ["--yes", { yes: true, stdinIsTty: false }, { kind: "proceed" }],
    [
      "--yes with CI and --no-interactive",
      { yes: true, ci: true, noInteractive: true },
      { kind: "proceed" },
    ],
    ["--dry-run without --yes", { dryRun: true, stdinIsTty: false }, { kind: "proceed" }],
    ["interactive terminal", {}, { kind: "prompt" }],
    ["no TTY", { stdinIsTty: false }, { kind: "refuse", reason: "no-terminal" }],
    [
      "--no-interactive on a TTY",
      { noInteractive: true },
      { kind: "refuse", reason: "no-interactive" },
    ],
    ["CI on a TTY", { ci: true }, { kind: "refuse", reason: "ci" }],
    [
      "stdin read by --input -",
      { stdinConsumed: true },
      { kind: "refuse", reason: "stdin-consumed" },
    ],
    [
      "--no-interactive wins over CI",
      { noInteractive: true, ci: true, stdinIsTty: false },
      { kind: "refuse", reason: "no-interactive" },
    ],
  ] as const)("%s -> %j", (_label, overrides, expected) => {
    expect(decideConfirmation({ ...base, ...overrides })).toStrictEqual(expected);
  });
});

describe("describeRefusal", () => {
  it.each([
    ["no-interactive", "--no-interactive was given"],
    ["ci", "CI is set"],
    ["stdin-consumed", "--input - takes its input from standard input"],
    ["no-terminal", "there is no terminal to confirm on"],
  ] as const)("explains %s", (reason, expected) => {
    expect(describeRefusal(reason)).toBe(expected);
  });
});

describe("isCiEnvironment", () => {
  it.each([
    [undefined, false],
    ["", false],
    ["0", false],
    ["false", false],
    ["FALSE", false],
    ["1", true],
    ["true", true],
    ["True", true],
    ["yes", true],
  ])("treats %j as %j", (value, expected) => {
    expect(isCiEnvironment(value)).toBe(expected);
  });
});

describe("isAffirmative", () => {
  it.each([
    ["y", true],
    ["Y", true],
    ["yes", true],
    ["  YES \n", true],
    ["", false],
    ["n", false],
    ["no", false],
    ["yep", false],
    ["yes please", false],
  ])("treats %j as %j", (answer, expected) => {
    expect(isAffirmative(answer)).toBe(expected);
  });
});
