import * as z from "zod";
import { toKebabCase, parseToolName } from "./tool-name.ts";
import { summarizeDescription } from "./summarize-description.ts";
import type { ToolDefinition } from "./tool-definition.ts";

export type PropertyKind = "string" | "integer" | "number" | "boolean" | "enum" | "json";

type JsonShape = "object" | "array" | "any";

export type PropertySpec = {
  key: string;
  flag: string | undefined;
  kind: PropertyKind;
  choices: readonly (string | number)[] | undefined;
  jsonShape: JsonShape;
  description: string | undefined;
  required: boolean;
  nullable: boolean;
};

export type ToolSpec = {
  toolName: string;
  namespace: string;
  command: string;
  summary: string;
  description: string;
  properties: readonly PropertySpec[];
  inputOnlyProperties: readonly string[];
  positional: PropertySpec | undefined;
  allowsAdditionalProperties: boolean;
  readOnly: boolean;
  destructive: boolean;
};

const RESERVED_FLAGS: ReadonlySet<string> = new Set([
  "help",
  "version",
  "env",
  "json",
  "input",
  "yes",
  "interactive",
  "no-interactive",
  "dry-run",
]);

const PropertySchema = z.looseObject({
  type: z.union([z.string(), z.array(z.string())]).optional(),
  enum: z.array(z.unknown()).optional(),
  description: z.string().optional(),
  anyOf: z.array(z.unknown()).optional(),
  oneOf: z.array(z.unknown()).optional(),
});

function isChoice(value: unknown): value is string | number {
  return typeof value === "string" || typeof value === "number";
}

function kindFromTypes(types: readonly string[]): PropertyKind {
  const [only, ...rest] = types;
  if (only === undefined || rest.length > 0) return "json";
  if (only === "string" || only === "integer" || only === "number" || only === "boolean") {
    return only;
  }
  return "json";
}

function jsonShapeOf(types: readonly string[]): JsonShape {
  const [only, ...rest] = types;
  if (rest.length > 0) return "any";
  if (only === "object") return "object";
  return only === "array" ? "array" : "any";
}

function allowsNull(schema: z.infer<typeof PropertySchema>, types: readonly string[]): boolean {
  if (types.includes("null")) return true;
  const alternatives = [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])];
  return alternatives.some((alternative) => {
    const parsed = PropertySchema.safeParse(alternative);
    return parsed.success && parsed.data.type === "null";
  });
}

function describeProperty(
  key: string,
  schema: unknown,
  required: boolean,
): Omit<PropertySpec, "flag"> {
  const parsed = PropertySchema.safeParse(schema);
  if (!parsed.success) {
    return {
      key,
      kind: "json",
      choices: undefined,
      jsonShape: "any",
      description: undefined,
      required,
      nullable: false,
    };
  }
  const { type, enum: enumValues, description } = parsed.data;
  const declared = typeof type === "string" ? [type] : (type ?? []);
  const nullable = allowsNull(parsed.data, declared) || enumValues?.includes(null) === true;
  const types = declared.filter((t) => t !== "null");
  const choices = enumValues?.filter((value) => isChoice(value));
  if (choices !== undefined && choices.length > 0) {
    return { key, kind: "enum", choices, jsonShape: "any", description, required, nullable };
  }
  const kind = kindFromTypes(types);
  return {
    key,
    kind,
    choices: undefined,
    jsonShape: kind === "json" ? jsonShapeOf(types) : "any",
    description,
    required,
    nullable,
  };
}

function claimFlag(property: Omit<PropertySpec, "flag">, taken: Set<string>): string | undefined {
  const flag = toKebabCase(property.key);
  const names = property.kind === "boolean" ? [flag, `no-${flag}`] : [flag];
  // Commander reads a `--no-x` option as the negation of `--x`, so such a flag cannot carry its own value.
  if (flag === "" || flag.startsWith("no-")) return undefined;
  if (names.some((name) => RESERVED_FLAGS.has(name) || taken.has(name))) {
    return undefined;
  }
  for (const name of names) taken.add(name);
  return flag;
}

export function buildToolSpec(tool: ToolDefinition): ToolSpec | undefined {
  const name = parseToolName(tool.name);
  if (name === undefined) return undefined;

  const required = new Set(tool.inputSchema.required);
  const taken = new Set<string>();
  const properties = Object.entries(tool.inputSchema.properties ?? {}).map(([key, schema]) => {
    const property = describeProperty(key, schema, required.has(key));
    return Object.assign(property, { flag: claimFlag(property, taken) });
  });

  const requiredProperties = properties.filter((property) => property.required);
  const [onlyRequired] = requiredProperties;
  const positional =
    requiredProperties.length === 1 && onlyRequired?.flag !== undefined ? onlyRequired : undefined;

  const readOnly = tool.annotations?.readOnlyHint === true;
  const description = tool.description?.trim() ?? "";
  return {
    toolName: tool.name,
    ...name,
    summary: summarizeDescription(description),
    description,
    properties,
    inputOnlyProperties: properties
      .filter((property) => property.flag === undefined)
      .map((property) => property.key),
    positional,
    allowsAdditionalProperties: tool.inputSchema.additionalProperties !== false,
    readOnly,
    destructive: !readOnly && tool.annotations?.destructiveHint !== false,
  };
}
