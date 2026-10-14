import { describe, expect, it } from "vitest";
import { resolveToolArguments } from "./resolve-tool-arguments.ts";
import type { PropertyKind, PropertySpec, ToolSpec } from "./build-tool-spec.ts";

function prop(key: string, kind: PropertyKind, extra: Partial<PropertySpec> = {}): PropertySpec {
  return {
    key,
    flag: key,
    kind,
    choices: undefined,
    jsonShape: "any",
    description: undefined,
    required: false,
    nullable: false,
    ...extra,
  };
}

function makeSpec(properties: PropertySpec[], extra: Partial<ToolSpec> = {}): ToolSpec {
  return {
    toolName: "ns.cmd",
    namespace: "ns",
    command: "cmd",
    summary: "",
    description: "",
    properties,
    inputOnlyProperties: [],
    positional: undefined,
    allowsAdditionalProperties: true,
    readOnly: false,
    destructive: true,
    ...extra,
  };
}

const none = { inputJson: undefined, flagValues: {}, positionalValue: undefined };

describe("resolveToolArguments", () => {
  it("returns an empty object when nothing is supplied and nothing is required", () => {
    expect(resolveToolArguments(makeSpec([prop("a", "string")]), none)).toStrictEqual({
      ok: true,
      value: {},
    });
  });

  it("merges --input with flags and lets flags override", () => {
    const spec = makeSpec([prop("a", "string"), prop("b", "integer")]);
    expect(
      resolveToolArguments(spec, {
        inputJson: '{"a":"from-input","b":1}',
        flagValues: { a: "from-flag" },
        positionalValue: undefined,
      }),
    ).toStrictEqual({ ok: true, value: { a: "from-flag", b: 1 } });
  });

  it.each([
    ["{bad", "--input must be valid JSON"],
    ["[1]", "--input must be a JSON object"],
    ["null", "--input must be a JSON object"],
    ['"s"', "--input must be a JSON object"],
  ])("rejects --input %j", (inputJson, error) => {
    expect(resolveToolArguments(makeSpec([]), { ...none, inputJson })).toStrictEqual({
      ok: false,
      error,
    });
  });

  describe("positional argument", () => {
    const id = prop("endpoint_id", "string", { flag: "endpoint-id", required: true });
    const spec = makeSpec([id], { positional: id });

    it("fills the positional property", () => {
      expect(resolveToolArguments(spec, { ...none, positionalValue: "abc" })).toStrictEqual({
        ok: true,
        value: { endpoint_id: "abc" },
      });
    });

    it("rejects a value given both positionally and as a flag", () => {
      expect(
        resolveToolArguments(spec, {
          ...none,
          flagValues: { endpoint_id: "x" },
          positionalValue: "abc",
        }),
      ).toStrictEqual({
        ok: false,
        error: "pass --endpoint-id either as the positional argument or as a flag, not both",
      });
    });

    it("lets the positional value override --input", () => {
      expect(
        resolveToolArguments(spec, {
          inputJson: '{"endpoint_id":"old"}',
          flagValues: {},
          positionalValue: "new",
        }),
      ).toStrictEqual({ ok: true, value: { endpoint_id: "new" } });
    });

    it("mentions the positional alternative when it is missing", () => {
      expect(resolveToolArguments(spec, none)).toStrictEqual({
        ok: false,
        error: "missing required argument --endpoint-id (or the <endpoint-id> argument)",
      });
    });
  });

  it("reports every missing required argument, naming flagless ones by key", () => {
    const spec = makeSpec([
      prop("a", "string", { required: true }),
      prop("odd_key", "string", { required: true, flag: undefined }),
    ]);
    expect(resolveToolArguments(spec, none)).toStrictEqual({
      ok: false,
      error: "missing required argument --a; missing required argument 'odd_key'",
    });
  });

  it("rejects unknown keys when additional properties are forbidden", () => {
    const spec = makeSpec([prop("a", "string")], { allowsAdditionalProperties: false });
    expect(
      resolveToolArguments(spec, { ...none, inputJson: '{"a":"x","zzz":1,"yyy":2}' }),
    ).toStrictEqual({ ok: false, error: "unknown argument 'zzz'; unknown argument 'yyy'" });
  });

  it("passes unknown keys through when additional properties are allowed", () => {
    expect(
      resolveToolArguments(makeSpec([prop("a", "string")]), { ...none, inputJson: '{"zzz":1}' }),
    ).toStrictEqual({ ok: true, value: { zzz: 1 } });
  });

  it.each([
    [prop("a", "string"), 1, "--a must be a string"],
    [prop("a", "integer"), 1.5, "--a must be an integer"],
    [prop("a", "integer"), "1", "--a must be an integer"],
    [prop("a", "number"), "1", "--a must be a number"],
    [prop("a", "boolean"), "true", "--a must be a boolean"],
    [prop("a", "enum", { choices: ["x", 2] }), "y", "--a must be one of: x, 2"],
    [prop("a", "enum", { choices: ["x", 2] }), "2", "--a must be one of: x, 2"],
    [prop("a", "string"), null, "--a must be a string (null is not allowed)"],
    [prop("a", "json"), null, "--a must be valid JSON (null is not allowed)"],
    [prop("a", "json", { jsonShape: "object" }), [1], "--a must be a JSON object"],
    [prop("a", "json", { jsonShape: "array" }), { k: 1 }, "--a must be a JSON array"],
  ])("rejects a wrongly typed value for %j", (property, value, error) => {
    expect(
      resolveToolArguments(makeSpec([property]), { ...none, flagValues: { a: value } }),
    ).toStrictEqual({ ok: false, error });
  });

  it.each([
    [prop("a", "string"), "x"],
    [prop("a", "integer"), 3],
    [prop("a", "number"), 3.5],
    [prop("a", "number"), 3],
    [prop("a", "boolean"), false],
    [prop("a", "enum", { choices: ["x", 2] }), 2],
    [prop("a", "json"), { any: ["thing"] }],
    [prop("a", "string", { nullable: true }), null],
    [prop("a", "json", { jsonShape: "object" }), { k: 1 }],
    [prop("a", "json", { jsonShape: "array" }), [1]],
  ])("accepts a correctly typed value for %j", (property, value) => {
    expect(
      resolveToolArguments(makeSpec([property]), { ...none, flagValues: { a: value } }),
    ).toStrictEqual({ ok: true, value: { a: value } });
  });

  it("treats an explicit null as present for a required property", () => {
    const spec = makeSpec([prop("a", "string", { required: true, nullable: true })]);
    expect(resolveToolArguments(spec, { ...none, inputJson: '{"a":null}' })).toStrictEqual({
      ok: true,
      value: { a: null },
    });
  });

  it("joins all problems with semicolons", () => {
    const spec = makeSpec([prop("a", "integer"), prop("b", "string", { required: true })], {
      allowsAdditionalProperties: false,
    });
    expect(resolveToolArguments(spec, { ...none, inputJson: '{"a":"x","c":1}' })).toStrictEqual({
      ok: false,
      error: "unknown argument 'c'; --a must be an integer; missing required argument --b",
    });
  });
});
