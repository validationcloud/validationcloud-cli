import { isPlainObject } from "./is-plain-object.ts";
import { matchesJsonShape } from "./coerce-flag-value.ts";
import { err, ok } from "./result.ts";
import type { Result } from "./result.ts";
import type { PropertySpec, ToolSpec } from "./build-tool-spec.ts";

export type ArgumentSources = {
  inputJson: string | undefined;
  flagValues: Readonly<Record<string, unknown>>;
  positionalValue: unknown;
};

function parseInputObject(inputJson: string): Result<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(inputJson);
  } catch {
    return err("--input must be valid JSON");
  }
  if (!isPlainObject(parsed)) return err("--input must be a JSON object");
  return ok(parsed);
}

function matchesKind(property: PropertySpec, value: unknown): boolean {
  if (value === null) return property.nullable;
  switch (property.kind) {
    case "string": {
      return typeof value === "string";
    }
    case "integer": {
      return Number.isInteger(value);
    }
    case "number": {
      return typeof value === "number";
    }
    case "boolean": {
      return typeof value === "boolean";
    }
    case "enum": {
      return (property.choices ?? []).some((choice) => choice === value);
    }
    case "json": {
      return matchesJsonShape(property, value);
    }
  }
}

function expectedKind(property: PropertySpec): string {
  if (property.kind === "enum") return `one of: ${(property.choices ?? []).join(", ")}`;
  if (property.kind === "json") {
    return property.jsonShape === "any" ? "valid JSON" : `a JSON ${property.jsonShape}`;
  }
  return property.kind === "integer" ? "an integer" : `a ${property.kind}`;
}

function nameOf(property: PropertySpec): string {
  return property.flag === undefined ? `'${property.key}'` : `--${property.flag}`;
}

export function resolveToolArguments(
  spec: ToolSpec,
  sources: ArgumentSources,
): Result<Record<string, unknown>> {
  let fromInput: Record<string, unknown> = {};
  if (sources.inputJson !== undefined) {
    const parsed = parseInputObject(sources.inputJson);
    if (!parsed.ok) return parsed;
    fromInput = parsed.value;
  }

  const { positional } = spec;
  if (
    positional !== undefined &&
    sources.positionalValue !== undefined &&
    sources.flagValues[positional.key] !== undefined
  ) {
    return err(
      `pass ${nameOf(positional)} either as the positional argument or as a flag, not both`,
    );
  }

  const merged: Record<string, unknown> = { ...fromInput, ...sources.flagValues };
  if (positional !== undefined && sources.positionalValue !== undefined) {
    merged[positional.key] = sources.positionalValue;
  }

  const problems: string[] = [];
  const known = new Set(spec.properties.map((property) => property.key));
  if (!spec.allowsAdditionalProperties) {
    for (const key of Object.keys(merged)) {
      if (!known.has(key)) problems.push(`unknown argument '${key}'`);
    }
  }
  for (const property of spec.properties) {
    const value = merged[property.key];
    if (value === undefined) {
      if (property.required) {
        const alias = property === positional ? ` (or the <${property.flag}> argument)` : "";
        problems.push(`missing required argument ${nameOf(property)}${alias}`);
      }
      continue;
    }
    if (!matchesKind(property, value)) {
      const nullNote = value === null ? " (null is not allowed)" : "";
      problems.push(`${nameOf(property)} must be ${expectedKind(property)}${nullNote}`);
    }
  }
  if (problems.length > 0) return err(problems.join("; "));
  return ok(merged);
}
