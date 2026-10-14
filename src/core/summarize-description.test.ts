import { describe, expect, it } from "vitest";
import { summarizeDescription } from "./summarize-description.ts";

describe("summarizeDescription", () => {
  it.each([
    ["First sentence. Second sentence.", "First sentence."],
    ["Only one line without period", "Only one line without period"],
    ["Ends with period.", "Ends with period."],
    ["Version 1.2 is supported. Yes.", "Version 1.2 is supported."],
    ["No period on first line\nSecond line. Yes.", "No period on first line"],
    ["  \n  Leading blank space. Rest.", "Leading blank space."],
    ["", ""],
  ])("summarizes %j as %j", (input, expected) => {
    expect(summarizeDescription(input)).toBe(expected);
  });
});
