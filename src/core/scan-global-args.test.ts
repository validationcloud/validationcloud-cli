import { describe, expect, it } from "vitest";
import { scanGlobalArgs } from "./scan-global-args.ts";

const empty = {
  firstToken: undefined,
  wantsHelp: false,
  wantsVersion: false,
  wantsJson: false,
};

describe("scanGlobalArgs", () => {
  it("returns defaults for no arguments", () => {
    expect(scanGlobalArgs([])).toStrictEqual(empty);
  });

  it("finds the first non-flag token", () => {
    expect(scanGlobalArgs(["nodeapi", "get-endpoint", "abc"])).toStrictEqual({
      ...empty,
      firstToken: "nodeapi",
    });
  });

  it.each([
    [["demo", "get-item", "--input", "--json"], { firstToken: "demo" }],
    [["demo", "get-item", "--input", "{}", "--json"], { firstToken: "demo", wantsJson: true }],
  ])("treats the value of --input as a value in %j", (argv, expected) => {
    expect(scanGlobalArgs(argv)).toStrictEqual({ ...empty, ...expected });
  });

  it.each([
    [["-h"], { wantsHelp: true }],
    [["--help"], { wantsHelp: true }],
    [["-V"], { wantsVersion: true }],
    [["--version"], { wantsVersion: true }],
    [["--json"], { wantsJson: true }],
    [["nodeapi", "--help", "--json"], { firstToken: "nodeapi", wantsHelp: true, wantsJson: true }],
  ])("detects %j", (argv, expected) => {
    expect(scanGlobalArgs(argv)).toStrictEqual({ ...empty, ...expected });
  });

  it("stops scanning at --", () => {
    expect(scanGlobalArgs(["--", "--help", "--json", "word"])).toStrictEqual(empty);
    expect(scanGlobalArgs(["nodeapi", "--", "--json"])).toStrictEqual({
      ...empty,
      firstToken: "nodeapi",
    });
  });

  it("ignores flags after the first token", () => {
    expect(scanGlobalArgs(["nodeapi", "--yes", "-x"])).toStrictEqual({
      ...empty,
      firstToken: "nodeapi",
    });
  });

  it("finds no first token after an unknown leading flag", () => {
    expect(scanGlobalArgs(["--bogus", "value", "tools"])).toStrictEqual(empty);
  });
});
