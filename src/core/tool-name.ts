export type ToolCommandName = { namespace: string; command: string };

export function toKebabCase(identifier: string): string {
  return identifier
    .replaceAll(/(?<lower>[a-z0-9])(?<upper>[A-Z])/gu, "$<lower>-$<upper>")
    .replaceAll(/(?<acronym>[A-Z]+)(?<word>[A-Z][a-z])/gu, "$<acronym>-$<word>")
    .replaceAll(/[^A-Za-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .toLowerCase();
}

export function parseToolName(toolName: string): ToolCommandName | undefined {
  const dotIndex = toolName.indexOf(".");
  if (dotIndex <= 0) return undefined;
  const namespace = toKebabCase(toolName.slice(0, dotIndex));
  const command = toKebabCase(toolName.slice(dotIndex + 1));
  if (namespace === "" || command === "") return undefined;
  return { namespace, command };
}
