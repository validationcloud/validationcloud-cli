import type { ToolSpec } from "./build-tool-spec.ts";

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : `  ${line.trimEnd()}`))
    .join("\n");
}

function formatToolBlock(spec: ToolSpec): string {
  const lines = [
    `valcloud ${spec.namespace} ${spec.command}`,
    `tool: ${spec.toolName}`,
    `read-only: ${spec.readOnly}`,
    `destructive: ${spec.destructive}`,
  ];
  if (spec.description === "") return lines.join("\n");
  return `${lines.join("\n")}\n\n${indent(spec.description)}`;
}

export function formatToolList(specs: readonly ToolSpec[]): string {
  if (specs.length === 0) return "";
  return `${specs.map((spec) => formatToolBlock(spec)).join("\n\n")}\n`;
}
