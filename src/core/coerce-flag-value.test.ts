import { describe, expect, it } from "vitest";
import { coerceFlagValue } from "./coerce-flag-value.ts";
import type { PropertySpec, PropertyKind } from "./build-tool-spec.ts";

function property(kind: PropertyKind, choices?: readonly (string | number)[]): PropertySpec {
  return {
    key: "k",
    flag: "k",
    kind,
    choices,
    jsonShape: "any",
    description: undefined,
    required: false,
    nullable: false,
  };
}

describe("coerceFlagValue", () => {
  it.each([
    ["string", "42", "42"],
    ["string", "", ""],
    ["integer", "42", 42],
    ["integer", "-7", -7],
    ["integer", "+3", 3],
    ["integer", "007", 7],
    ["number", "1.5", 1.5],
    ["number", ".5", 0.5],
    ["number", "5.", 5],
    ["number", "-1e3", -1000],
    ["number", "2E-2", 0.02],
    ["number", "7", 7],
    ["boolean", "true", true],
    ["boolean", "false", false],
    ["json", '{"a":[1,2]}', { a: [1, 2] }],
    ["json", '"text"', "text"],
  ] as const)("coerces %s %j to %j", (kind, raw, expected) => {
    expect(coerceFlagValue(property(kind), raw)).toStrictEqual({ ok: true, value: expected });
  });

  it.each([
    ["integer", "1.5", "expected an integer, got '1.5'"],
    ["integer", "", "expected an integer, got ''"],
    ["integer", "abc", "expected an integer, got 'abc'"],
    ["integer", "1e3", "expected an integer, got '1e3'"],
    ["integer", "9007199254740993", "expected an integer, got '9007199254740993'"],
    ["number", "abc", "expected a number, got 'abc'"],
    ["number", "", "expected a number, got ''"],
    ["number", "Infinity", "expected a number, got 'Infinity'"],
    ["number", "0x10", "expected a number, got '0x10'"],
    ["number", "1e", "expected a number, got '1e'"],
    ["boolean", "TRUE", "expected true or false, got 'TRUE'"],
    ["boolean", "1", "expected true or false, got '1'"],
    ["json", "{oops", "expected valid JSON, got '{oops'"],
    ["json", "", "expected valid JSON, got ''"],
  ] as const)("rejects %s %j", (kind, raw, error) => {
    expect(coerceFlagValue(property(kind), raw)).toStrictEqual({ ok: false, error });
  });

  it("accepts JSON null only for a nullable property", () => {
    const nullable = { ...property("json"), nullable: true };
    expect(coerceFlagValue(nullable, "null")).toStrictEqual({ ok: true, value: null });
    expect(coerceFlagValue(property("json"), "null")).toStrictEqual({
      ok: false,
      error: "null is not allowed here",
    });
  });

  it.each([
    ["object", '{"a":1}', { a: 1 }],
    ["array", "[1]", [1]],
    ["any", "7", 7],
  ] as const)("accepts JSON %s matching the %s shape", (jsonShape, raw, value) => {
    expect(coerceFlagValue({ ...property("json"), jsonShape }, raw)).toStrictEqual({
      ok: true,
      value,
    });
  });

  it.each([
    ["object", "[1]", "expected a JSON object"],
    ["object", '"x"', "expected a JSON object"],
    ["array", '{"a":1}', "expected a JSON array"],
  ] as const)("rejects JSON %s that is not the %s shape", (jsonShape, raw, error) => {
    expect(coerceFlagValue({ ...property("json"), jsonShape }, raw)).toStrictEqual({
      ok: false,
      error,
    });
  });

  it("truncates long values in error messages to 40 characters", () => {
    expect(
      coerceFlagValue(property("integer"), "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"),
    ).toStrictEqual({
      ok: false,
      error: "expected an integer, got 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx...'",
    });
  });

  it("returns the typed choice matching the raw text", () => {
    expect(coerceFlagValue(property("enum", ["eth", 2, "3"]), "2")).toStrictEqual({
      ok: true,
      value: 2,
    });
    expect(coerceFlagValue(property("enum", ["eth", 2, "3"]), "eth")).toStrictEqual({
      ok: true,
      value: "eth",
    });
  });

  it("lists the choices when an enum value is not one of them", () => {
    expect(coerceFlagValue(property("enum", ["eth", 2]), "sol")).toStrictEqual({
      ok: false,
      error: "expected one of: eth, 2; got 'sol'",
    });
  });
});
