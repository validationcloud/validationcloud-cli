import { describe, expect, it } from "vitest";
import { describeOption } from "./describe-option.ts";
import type { PropertySpec } from "./build-tool-spec.ts";

describe("describeOption", () => {
  const base: PropertySpec = {
    key: "k",
    flag: "k",
    kind: "string",
    choices: undefined,
    jsonShape: "any",
    description: undefined,
    required: false,
    nullable: false,
  };

  it.each([
    [{}, "string"],
    [{ kind: "integer" }, "integer"],
    [{ description: "   " }, "string"],
    [{ kind: "enum", choices: ["eth", 2] }, "one of: eth, 2"],
    [{ kind: "json", jsonShape: "object" }, "JSON object"],
    [{ kind: "json", jsonShape: "array", required: true }, "JSON array (required)"],
    [{ kind: "json" }, "JSON value"],
    [{ description: "Endpoint id" }, "Endpoint id"],
    [{ description: "Chain", kind: "enum", choices: ["eth", 2] }, "Chain (one of: eth, 2)"],
    [{ description: "Filter", kind: "json" }, "Filter (JSON)"],
    [{ description: "Name", required: true }, "Name (required)"],
  ] as const)("describes %j as %j", (overrides, expected) => {
    expect(describeOption({ ...base, ...overrides })).toBe(expected);
  });
});
