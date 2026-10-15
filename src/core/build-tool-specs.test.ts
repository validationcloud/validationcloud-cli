import { describe, expect, it } from "vitest";
import { buildToolSpecs, groupByNamespace } from "./build-tool-specs.ts";

const inputSchema = {};

describe("buildToolSpecs", () => {
  it("skips tools without a namespace and in reserved namespaces", () => {
    const { specs } = buildToolSpecs(
      [
        { name: "ping", inputSchema },
        { name: "auth.login", inputSchema },
        { name: "nodeapi.get_endpoint", inputSchema },
      ],
      new Set(["auth"]),
    );
    expect(specs.map((spec) => spec.toolName)).toStrictEqual(["nodeapi.get_endpoint"]);
  });

  it("reports each skipped tool with the reason", () => {
    const { unmapped } = buildToolSpecs(
      [
        { name: "ping", inputSchema },
        { name: "auth.login", inputSchema },
        { name: "tools.list", inputSchema },
        { name: "nodeapi.get_endpoint", inputSchema },
        { name: "nodeapi.getEndpoint", inputSchema },
      ],
      new Set(["auth", "tools"]),
    );
    expect(unmapped).toStrictEqual([
      { toolName: "ping", reason: "the tool name is not of the form <namespace>.<command>" },
      { toolName: "auth.login", reason: "the namespace 'auth' is a built-in valcloud command" },
      { toolName: "tools.list", reason: "the namespace 'tools' is a built-in valcloud command" },
      {
        toolName: "nodeapi.getEndpoint",
        reason:
          "the command 'valcloud nodeapi get-endpoint' is already taken by nodeapi.get_endpoint",
      },
    ]);
  });

  it("keeps the first of tools that map to the same command", () => {
    const { specs } = buildToolSpecs(
      [
        { name: "nodeapi.get_endpoint", description: "first", inputSchema },
        { name: "nodeapi.getEndpoint", description: "second", inputSchema },
        { name: "nodeapi.get-endpoint", description: "third", inputSchema },
      ],
      new Set(),
    );
    expect(specs.map((spec) => spec.description)).toStrictEqual(["first"]);
  });

  it("keeps the same command name in different namespaces", () => {
    const { specs } = buildToolSpecs(
      [
        { name: "a.list", inputSchema },
        { name: "b.list", inputSchema },
      ],
      new Set(),
    );
    expect(specs.map((spec) => `${spec.namespace}/${spec.command}`)).toStrictEqual([
      "a/list",
      "b/list",
    ]);
  });
});

describe("groupByNamespace", () => {
  it("groups specs by namespace preserving order", () => {
    const { specs } = buildToolSpecs(
      [
        { name: "b.one", inputSchema },
        { name: "a.two", inputSchema },
        { name: "b.three", inputSchema },
      ],
      new Set(),
    );
    const groups = groupByNamespace(specs);
    expect([...groups.keys()]).toStrictEqual(["b", "a"]);
    expect(groups.get("b")?.map((spec) => spec.command)).toStrictEqual(["one", "three"]);
  });

  it("returns an empty map for no specs", () => {
    expect(groupByNamespace([]).size).toBe(0);
  });
});
