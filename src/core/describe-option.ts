import type { PropertySpec } from "./build-tool-spec.ts";

function describeType(property: PropertySpec): string {
  if (property.kind === "enum") return `one of: ${(property.choices ?? []).join(", ")}`;
  if (property.kind === "json") {
    return property.jsonShape === "any" ? "JSON value" : `JSON ${property.jsonShape}`;
  }
  return property.kind;
}

export function describeOption(property: PropertySpec): string {
  const description = property.description?.trim() ?? "";
  const parts = [description === "" ? describeType(property) : description];
  if (description !== "") {
    if (property.choices !== undefined) parts.push(`(one of: ${property.choices.join(", ")})`);
    if (property.kind === "json") parts.push("(JSON)");
  }
  if (property.required) parts.push("(required)");
  return parts.join(" ");
}
