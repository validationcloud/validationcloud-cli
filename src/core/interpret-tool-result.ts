export type ToolContentBlock = { type: string; text?: string | undefined };

export type ToolCallResult = {
  isError?: boolean | undefined;
  content?: readonly ToolContentBlock[] | undefined;
  structuredContent?: unknown;
};

export type ToolFailure = {
  code: string | undefined;
  message: string;
  retryAfterSeconds: number | undefined;
};

export type ToolOutcome =
  | { kind: "structured"; value: unknown }
  | { kind: "text"; text: string }
  | { kind: "empty" }
  | { kind: "failure"; failure: ToolFailure };

export function joinTextBlocks(content: readonly ToolContentBlock[] | undefined): string {
  return (content ?? [])
    .flatMap((block) => (block.type === "text" && block.text !== undefined ? [block.text] : []))
    .join("\n");
}

export function parseToolError(text: string): ToolFailure {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && "message" in parsed) {
      const { message } = parsed;
      const code = "code" in parsed ? parsed.code : undefined;
      const retry = "retry_after_seconds" in parsed ? parsed.retry_after_seconds : undefined;
      if (typeof message === "string") {
        return {
          code: typeof code === "string" ? code : undefined,
          message,
          retryAfterSeconds: typeof retry === "number" ? retry : undefined,
        };
      }
    }
  } catch {
    // Not JSON: Mavrik and gateway errors are plain text.
  }
  return { code: undefined, message: text, retryAfterSeconds: undefined };
}

export function interpretToolResult(result: ToolCallResult): ToolOutcome {
  const text = joinTextBlocks(result.content);
  if (result.isError === true) {
    return { kind: "failure", failure: parseToolError(text === "" ? "tool call failed" : text) };
  }
  if (result.structuredContent !== undefined) {
    return { kind: "structured", value: result.structuredContent };
  }
  return text === "" ? { kind: "empty" } : { kind: "text", text };
}

export function parseTextAsJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
