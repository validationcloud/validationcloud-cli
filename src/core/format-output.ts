import { isPlainObject } from "./is-plain-object.ts";

type Entry = [key: string, value: unknown];

function escapeControlCharacters(text: string): string {
  return text
    .replaceAll("\t", String.raw`\t`)
    .replaceAll("\n", String.raw`\n`)
    .replaceAll("\r", String.raw`\r`);
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return escapeControlCharacters(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value);
}

function flattenRecord(record: Record<string, unknown>, prefix = ""): Entry[] {
  return Object.entries(record).flatMap(([key, value]): Entry[] => {
    const path = `${prefix}${key}`;
    if (isPlainObject(value) && Object.keys(value).length > 0) {
      return flattenRecord(value, `${path}.`);
    }
    return [[path, value]];
  });
}

function formatTable(rows: readonly Record<string, unknown>[]): string {
  const flattened = rows.map((row) => new Map(flattenRecord(row)));
  const columns = [...new Set(flattened.flatMap((row) => [...row.keys()]))];
  const lines = [
    columns.map((column) => column.toUpperCase()).join("\t"),
    ...flattened.map((row) => columns.map((column) => formatCell(row.get(column))).join("\t")),
  ];
  return `${lines.join("\n")}\n`;
}

function isMultilineString(value: unknown): value is string {
  return typeof value === "string" && value.includes("\n");
}

function withTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function formatKeyValues(record: Record<string, unknown>): string {
  const entries = flattenRecord(record);
  const scalarLines = entries
    .filter(([, value]) => !isMultilineString(value))
    .map(([key, value]) => `${key}\t${formatCell(value)}`);
  const blocks = entries.filter((entry): entry is [string, string] => isMultilineString(entry[1]));

  if (scalarLines.length === 0 && blocks.length === 1) {
    return withTrailingNewline(blocks[0]?.[1] ?? "");
  }
  const sections = [
    ...(scalarLines.length > 0 ? [scalarLines.join("\n")] : []),
    ...blocks.map(([key, text]) => `${key}:\n${text.replace(/\n+$/u, "")}`),
  ];
  return `${sections.join("\n\n")}\n`;
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => isPlainObject(item));
}

export function formatHuman(value: unknown): string {
  if (isRecordArray(value)) return formatTable(value);
  if (Array.isArray(value)) {
    return value.length === 0 ? "" : `${value.map((item) => formatCell(item)).join("\n")}\n`;
  }
  if (!isPlainObject(value)) return `${formatCell(value)}\n`;

  const values = Object.values(value);
  const [only] = values;
  if (values.length === 1 && Array.isArray(only) && (isRecordArray(only) || only.length === 0)) {
    return isRecordArray(only) ? formatTable(only) : "";
  }
  return Object.keys(value).length === 0 ? "" : formatKeyValues(value);
}

export function formatText(text: string): string {
  return withTrailingNewline(text);
}

export function formatJson(value: unknown, pretty: boolean): string {
  return `${JSON.stringify(value === undefined ? null : value, undefined, pretty ? 2 : undefined)}\n`;
}
