import { formatHuman, formatJson, formatText } from "./format-output.ts";
import { parseTextAsJson } from "./interpret-tool-result.ts";
import type { ToolOutcome } from "./interpret-tool-result.ts";

export type RenderOptions = { json: boolean; pretty: boolean };

export function renderOutcome(
  outcome: Exclude<ToolOutcome, { kind: "failure" }>,
  options: RenderOptions,
): string {
  if (options.json) {
    switch (outcome.kind) {
      case "structured": {
        return formatJson(outcome.value, options.pretty);
      }
      case "text": {
        return formatJson(parseTextAsJson(outcome.text), options.pretty);
      }
      case "empty": {
        return formatJson(undefined, options.pretty);
      }
    }
  }
  switch (outcome.kind) {
    case "structured": {
      return formatHuman(outcome.value);
    }
    case "text": {
      return formatText(outcome.text);
    }
    case "empty": {
      return "";
    }
  }
}
