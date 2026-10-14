import { buildToolSpec } from "./build-tool-spec.ts";
import type { ToolSpec } from "./build-tool-spec.ts";
import type { ToolDefinition } from "./tool-definition.ts";

type UnmappedTool = { toolName: string; reason: string };

export type ToolSpecs = { specs: ToolSpec[]; unmapped: UnmappedTool[] };

export function buildToolSpecs(
  tools: readonly ToolDefinition[],
  reservedNamespaces: ReadonlySet<string>,
): ToolSpecs {
  const claimedBy = new Map<string, string>();
  const specs: ToolSpec[] = [];
  const unmapped: UnmappedTool[] = [];
  for (const tool of tools) {
    const spec = buildToolSpec(tool);
    if (spec === undefined) {
      unmapped.push({
        toolName: tool.name,
        reason: "the tool name is not of the form <namespace>.<command>",
      });
      continue;
    }
    if (reservedNamespaces.has(spec.namespace)) {
      unmapped.push({
        toolName: tool.name,
        reason: `the namespace '${spec.namespace}' is a built-in vcloud command`,
      });
      continue;
    }
    const identity = `${spec.namespace} ${spec.command}`;
    const owner = claimedBy.get(identity);
    if (owner !== undefined) {
      unmapped.push({
        toolName: tool.name,
        reason: `the command 'vcloud ${identity}' is already taken by ${owner}`,
      });
      continue;
    }
    claimedBy.set(identity, tool.name);
    specs.push(spec);
  }
  return { specs, unmapped };
}

export function groupByNamespace(specs: readonly ToolSpec[]): Map<string, ToolSpec[]> {
  const groups = new Map<string, ToolSpec[]>();
  for (const spec of specs) {
    groups.set(spec.namespace, [...(groups.get(spec.namespace) ?? []), spec]);
  }
  return groups;
}
