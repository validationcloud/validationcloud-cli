import { isPlainObject } from "./is-plain-object.ts";
import { err, ok } from "./result.ts";
import type { Result } from "./result.ts";
import type { PropertySpec } from "./build-tool-spec.ts";

const INTEGER_PATTERN = /^[+-]?\d+$/u;
const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u;

function preview(raw: string): string {
  return raw.length > 40 ? `${raw.slice(0, 40)}...` : raw;
}

export function matchesJsonShape(property: PropertySpec, value: unknown): boolean {
  if (value === null) return property.nullable;
  if (property.jsonShape === "object") return isPlainObject(value);
  return property.jsonShape === "array" ? Array.isArray(value) : true;
}

function checkJsonShape(property: PropertySpec, value: unknown): Result<unknown> {
  if (matchesJsonShape(property, value)) return ok(value);
  if (value === null) return err("null is not allowed here");
  return err(`expected a JSON ${property.jsonShape}`);
}

export function coerceFlagValue(property: PropertySpec, raw: string): Result<unknown> {
  switch (property.kind) {
    case "string": {
      return ok(raw);
    }
    case "integer": {
      if (!INTEGER_PATTERN.test(raw) || !Number.isSafeInteger(Number(raw))) {
        return err(`expected an integer, got '${preview(raw)}'`);
      }
      return ok(Number(raw));
    }
    case "number": {
      if (!NUMBER_PATTERN.test(raw)) return err(`expected a number, got '${preview(raw)}'`);
      return ok(Number(raw));
    }
    case "boolean": {
      if (raw === "true") return ok(true);
      if (raw === "false") return ok(false);
      return err(`expected true or false, got '${preview(raw)}'`);
    }
    case "enum": {
      const choices = property.choices ?? [];
      const match = choices.find((choice) => String(choice) === raw);
      if (match === undefined) {
        return err(`expected one of: ${choices.join(", ")}; got '${preview(raw)}'`);
      }
      return ok(match);
    }
    case "json": {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return err(`expected valid JSON, got '${preview(raw)}'`);
      }
      return checkJsonShape(property, parsed);
    }
  }
}
