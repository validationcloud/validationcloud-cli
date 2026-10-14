import { describe, expect, it } from "vitest";
import { buildToolSpec } from "./build-tool-spec.ts";
import type { ToolDefinition } from "./tool-definition.ts";

function tool(overrides: Partial<ToolDefinition> & { properties?: Record<string, unknown> }) {
  const { properties, ...rest } = overrides;
  return {
    name: "nodeapi.get_endpoint",
    inputSchema: { properties: properties ?? {} },
    ...rest,
  } satisfies ToolDefinition;
}

function allows(additionalProperties: unknown): boolean | undefined {
  return buildToolSpec({ name: "a.b", inputSchema: { additionalProperties } })
    ?.allowsAdditionalProperties;
}

describe("buildToolSpec", () => {
  it("returns undefined for a tool name without a namespace", () => {
    expect(buildToolSpec(tool({ name: "ping" }))).toBeUndefined();
  });

  it("builds the namespace, command and summary from the name and description", () => {
    const spec = buildToolSpec(
      tool({
        name: "mavrik.answerQuestion",
        description: "  Ask Mavrik a question. Returns an answer.\nMore detail.  ",
      }),
    );
    expect(spec).toMatchObject({
      toolName: "mavrik.answerQuestion",
      namespace: "mavrik",
      command: "answer-question",
      summary: "Ask Mavrik a question.",
      description: "Ask Mavrik a question. Returns an answer.\nMore detail.",
    });
  });

  it("uses an empty description when none is given", () => {
    expect(buildToolSpec(tool({ description: null }))).toMatchObject({
      summary: "",
      description: "",
    });
  });

  it("detects the kind of each property", () => {
    const spec = buildToolSpec(
      tool({
        properties: {
          name: { type: "string" },
          limit: { type: "integer" },
          ratio: { type: "number" },
          active: { type: "boolean" },
          maybe: { type: ["boolean", "null"] },
          chain: { type: "string", enum: ["eth", "sol"] },
          level: { enum: [1, 2] },
          filter: { type: "object" },
          ids: { type: "array", items: { type: "string" } },
          either: { type: ["string", "number"] },
          untyped: {},
          garbage: "not a schema",
        },
      }),
    );
    expect(spec?.properties.map(({ key, kind }) => [key, kind])).toStrictEqual([
      ["name", "string"],
      ["limit", "integer"],
      ["ratio", "number"],
      ["active", "boolean"],
      ["maybe", "boolean"],
      ["chain", "enum"],
      ["level", "enum"],
      ["filter", "json"],
      ["ids", "json"],
      ["either", "json"],
      ["untyped", "json"],
      ["garbage", "json"],
    ]);
  });

  it("keeps string and numeric enum choices and drops other values", () => {
    const spec = buildToolSpec(tool({ properties: { mode: { enum: ["a", 2, null, true] } } }));
    expect(spec?.properties[0]).toMatchObject({ kind: "enum", choices: ["a", 2] });
  });

  it("falls back to the base type when an enum has no string or numeric choices", () => {
    const spec = buildToolSpec(tool({ properties: { flag: { type: "boolean", enum: [null] } } }));
    expect(spec?.properties[0]).toMatchObject({ kind: "boolean", choices: undefined });
  });

  it("derives kebab-case flags and no-flags for booleans", () => {
    const spec = buildToolSpec(
      tool({ properties: { endpoint_id: { type: "string" }, includeStats: { type: "boolean" } } }),
    );
    expect(spec?.properties.map(({ flag }) => flag)).toStrictEqual([
      "endpoint-id",
      "include-stats",
    ]);
  });

  it("leaves reserved names without a flag", () => {
    const spec = buildToolSpec(
      tool({
        properties: {
          help: { type: "string" },
          json: { type: "string" },
          input: { type: "string" },
          env: { type: "string" },
          yes: { type: "string" },
          version: { type: "string" },
          noInteractive: { type: "string" },
          interactive: { type: "boolean" },
          dryRun: { type: "string" },
          ok: { type: "string" },
        },
      }),
    );
    expect(spec?.properties.map(({ flag }) => flag)).toStrictEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "ok",
    ]);
    expect(spec?.inputOnlyProperties).toStrictEqual([
      "help",
      "json",
      "input",
      "env",
      "yes",
      "version",
      "noInteractive",
      "interactive",
      "dryRun",
    ]);
  });

  it("gives colliding properties a flag only to the first one", () => {
    const spec = buildToolSpec(
      tool({ properties: { endpoint_id: { type: "string" }, endpointId: { type: "string" } } }),
    );
    expect(spec?.properties.map(({ flag }) => flag)).toStrictEqual(["endpoint-id", undefined]);
  });

  it("leaves properties named like a negated flag input-only", () => {
    const spec = buildToolSpec(
      tool({
        properties: {
          no_cache: { type: "string" },
          noWait: { type: "boolean" },
          cache: { type: "boolean" },
        },
      }),
    );
    expect(spec?.properties.map(({ flag }) => flag)).toStrictEqual([undefined, undefined, "cache"]);
    expect(spec?.inputOnlyProperties).toStrictEqual(["no_cache", "noWait"]);
  });

  it("leaves a key that kebab-cases to nothing without a flag", () => {
    const spec = buildToolSpec(tool({ properties: { $$: { type: "string" } } }));
    expect(spec?.properties[0]?.flag).toBeUndefined();
  });

  it("marks required properties and uses a single required one as positional", () => {
    const spec = buildToolSpec(
      tool({
        inputSchema: {
          properties: { endpoint_id: { type: "string" }, limit: { type: "integer" } },
          required: ["endpoint_id"],
        },
      }),
    );
    expect(spec?.properties.map(({ key, required }) => [key, required])).toStrictEqual([
      ["endpoint_id", true],
      ["limit", false],
    ]);
    expect(spec?.positional?.key).toBe("endpoint_id");
  });

  it("has no positional when several properties are required", () => {
    const spec = buildToolSpec({
      name: "a.b",
      inputSchema: {
        properties: { x: { type: "string" }, y: { type: "string" } },
        required: ["x", "y"],
      },
    });
    expect(spec?.positional).toBeUndefined();
  });

  it("has no positional when the single required property has no flag", () => {
    const spec = buildToolSpec({
      name: "a.b",
      inputSchema: { properties: { input: { type: "string" } }, required: ["input"] },
    });
    expect(spec?.positional).toBeUndefined();
  });

  it("marks nullable properties from a type array, anyOf, oneOf or an enum with null", () => {
    const spec = buildToolSpec(
      tool({
        properties: {
          a: { type: ["string", "null"] },
          b: { anyOf: [{ type: "integer" }, { type: "null" }] },
          c: { oneOf: [{ type: "string" }, { type: "null" }] },
          d: { type: "string", enum: ["x", null] },
          e: { type: "string" },
          f: {},
        },
      }),
    );
    expect(spec?.properties.map(({ key, nullable }) => [key, nullable])).toStrictEqual([
      ["a", true],
      ["b", true],
      ["c", true],
      ["d", true],
      ["e", false],
      ["f", false],
    ]);
  });

  it("records the JSON shape of json properties", () => {
    const spec = buildToolSpec(
      tool({
        properties: {
          o: { type: "object" },
          a: { type: "array" },
          n: { type: ["object", "null"] },
          either: { type: ["object", "array"] },
          untyped: {},
          s: { type: "string" },
        },
      }),
    );
    expect(spec?.properties.map(({ key, jsonShape }) => [key, jsonShape])).toStrictEqual([
      ["o", "object"],
      ["a", "array"],
      ["n", "object"],
      ["either", "any"],
      ["untyped", "any"],
      ["s", "any"],
    ]);
  });

  it("lists properties without a flag as input-only", () => {
    const spec = buildToolSpec(
      tool({ properties: { json: { type: "string" }, endpoint_id: { type: "string" } } }),
    );
    expect(spec?.inputOnlyProperties).toStrictEqual(["json"]);
  });

  it("allows additional properties unless the schema forbids them", () => {
    expect([
      allows(undefined),
      allows(true),
      allows({ type: "string" }),
      allows(false),
    ]).toStrictEqual([true, true, true, false]);
  });

  it.each([
    ["no annotations", undefined, { readOnly: false, destructive: true }],
    ["empty annotations", {}, { readOnly: false, destructive: true }],
    [
      "null hints",
      { readOnlyHint: null, destructiveHint: null },
      { readOnly: false, destructive: true },
    ],
    ["destructiveHint true", { destructiveHint: true }, { readOnly: false, destructive: true }],
    ["destructiveHint false", { destructiveHint: false }, { readOnly: false, destructive: false }],
    ["readOnlyHint true", { readOnlyHint: true }, { readOnly: true, destructive: false }],
    [
      "readOnlyHint true overrides destructiveHint true",
      { readOnlyHint: true, destructiveHint: true },
      { readOnly: true, destructive: false },
    ],
    ["readOnlyHint false", { readOnlyHint: false }, { readOnly: false, destructive: true }],
  ])("annotation semantics: %s", (_label, annotations, expected) => {
    const spec = buildToolSpec({ name: "a.b", inputSchema: {}, annotations });
    expect({ readOnly: spec?.readOnly, destructive: spec?.destructive }).toStrictEqual(expected);
  });
});
