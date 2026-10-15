import { authHint } from "./auth-hint.ts";
import type { AuthHintContext } from "./auth-hint.ts";
import { FailureKind } from "./exit-codes.ts";
import type { ToolFailure } from "./interpret-tool-result.ts";

export type CliFailure = {
  kind: FailureKind;
  code: string | undefined;
  message: string;
  hint: string | undefined;
  retryAfterSeconds: number | undefined;
  rpcCode: number | undefined;
};

const DEFAULT_JSON_CODES: Record<FailureKind, string> = {
  tool: "tool_error",
  runtime: "runtime_error",
  usage: "usage_error",
  auth: "auth_required",
};

export function createFailure(kind: FailureKind, message: string, hint?: string): CliFailure {
  return { kind, code: undefined, message, hint, retryAfterSeconds: undefined, rpcCode: undefined };
}

export function failureFromTool(tool: ToolFailure, context: AuthHintContext): CliFailure {
  const isAuth = tool.code === "unauthorized";
  return {
    kind: isAuth ? FailureKind.auth : FailureKind.tool,
    code: tool.code,
    message: tool.message,
    hint: isAuth ? authHint(context) : undefined,
    retryAfterSeconds: tool.retryAfterSeconds,
    rpcCode: undefined,
  };
}

export function formatFailure(failure: CliFailure, json: boolean): string {
  if (json) {
    const error = {
      code: failure.code ?? DEFAULT_JSON_CODES[failure.kind],
      message: failure.message,
      ...(failure.retryAfterSeconds === undefined
        ? {}
        : { retry_after_seconds: failure.retryAfterSeconds }),
      ...(failure.rpcCode === undefined ? {} : { rpc_code: failure.rpcCode }),
      ...(failure.hint === undefined ? {} : { hint: failure.hint }),
    };
    return `${JSON.stringify({ error })}\n`;
  }
  const prefix = failure.code === undefined ? "" : `${failure.code}: `;
  const retry =
    failure.retryAfterSeconds === undefined ? "" : ` (retry after ${failure.retryAfterSeconds}s)`;
  const hint = failure.hint === undefined ? "" : `\nhint: ${failure.hint}`;
  return `valcloud: ${prefix}${failure.message}${retry}${hint}\n`;
}

export class CliFailureError extends Error {
  readonly failure: CliFailure;

  constructor(failure: CliFailure) {
    super(failure.message);
    this.name = "CliFailureError";
    this.failure = failure;
  }
}
