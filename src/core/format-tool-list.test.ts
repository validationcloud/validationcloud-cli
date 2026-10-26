import { describe, expect, it } from "vitest";
import type { ToolSpec } from "./build-tool-spec.ts";
import { formatToolList } from "./format-tool-list.ts";

function spec(overrides: Partial<ToolSpec>): ToolSpec {
  return {
    toolName: "mavrik.run_query",
    namespace: "mavrik",
    command: "run-query",
    summary: "",
    description: "",
    properties: [],
    inputOnlyProperties: [],
    positional: undefined,
    allowsAdditionalProperties: true,
    readOnly: true,
    destructive: false,
    ...overrides,
  };
}

describe("formatToolList", () => {
  it("prints every sentence of a description, indented under the command", () => {
    const description =
      "Run a Mavrik query. Mavrik covers different chains than Node API.\nCreating an endpoint is free and needs no approval.";

    expect(formatToolList([spec({ description })])).toBe(
      [
        "valcloud mavrik run-query",
        "tool: mavrik.run_query",
        "read-only: true",
        "destructive: false",
        "",
        "  Run a Mavrik query. Mavrik covers different chains than Node API.",
        "  Creating an endpoint is free and needs no approval.",
        "",
      ].join("\n"),
    );
  });

  it("keeps blank lines inside a description empty", () => {
    const output = formatToolList([spec({ description: "First.\n\nSecond." })]);

    expect(output).toContain("  First.\n\n  Second.\n");
  });

  it("separates tools with a blank line and reports destructive tools", () => {
    const output = formatToolList([
      spec({ description: "Read it." }),
      spec({
        toolName: "nodeapi.delete_endpoint",
        namespace: "nodeapi",
        command: "delete-endpoint",
        readOnly: false,
        destructive: true,
        description: "Delete it.",
      }),
    ]);

    expect(output).toBe(
      [
        "valcloud mavrik run-query",
        "tool: mavrik.run_query",
        "read-only: true",
        "destructive: false",
        "",
        "  Read it.",
        "",
        "valcloud nodeapi delete-endpoint",
        "tool: nodeapi.delete_endpoint",
        "read-only: false",
        "destructive: true",
        "",
        "  Delete it.",
        "",
      ].join("\n"),
    );
  });

  it("omits the description section for a tool without one", () => {
    expect(formatToolList([spec({})])).toBe(
      "valcloud mavrik run-query\ntool: mavrik.run_query\nread-only: true\ndestructive: false\n",
    );
  });

  it("prints nothing for an empty list", () => {
    expect(formatToolList([])).toBe("");
  });
});
