import {
  OAuthError,
  ProtocolError,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import { AuthRequiredError } from "#auth/auth-required-error";
import { CredentialsFileError } from "#auth/credentials-file-error";
import { RefreshFailedError } from "#auth/refresh-failed-error";
import type { ErrorFacts, ErrorLink } from "#core/map-error";

function causeChain(error: unknown): Error[] {
  const chain: Error[] = [];
  let current: unknown = error;
  while (current instanceof Error && !chain.includes(current)) {
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

function toLink(error: Error): ErrorLink {
  const { code } = error as { code?: unknown };
  return {
    message: error.message,
    code: typeof code === "string" ? code : undefined,
    isFetchFailure: error instanceof TypeError && error.message === "fetch failed",
  };
}

function timeoutOf(error: SdkError): number | undefined {
  const { data } = error;
  if (typeof data !== "object" || data === null || !("timeout" in data)) return undefined;
  return typeof data.timeout === "number" ? data.timeout : undefined;
}

export function classifyError(error: unknown): ErrorFacts {
  if (error instanceof AuthRequiredError) return { kind: "login-required" };
  if (error instanceof UnauthorizedError) return { kind: "http-unauthorized" };
  if (error instanceof RefreshFailedError) {
    return {
      kind: "refresh-unavailable",
      detail: "the authorization server or the network failed",
    };
  }
  if (error instanceof CredentialsFileError) return { kind: "other", message: error.message };
  if (error instanceof OAuthError) return { kind: "oauth", code: error.code };
  if (error instanceof ProtocolError) {
    return { kind: "protocol", rpcCode: error.code, message: error.message };
  }
  if (error instanceof SdkHttpError) {
    return error.status === 401
      ? { kind: "http-unauthorized" }
      : { kind: "http-status", status: error.status, message: error.message };
  }
  if (error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout) {
    return { kind: "timeout", timeoutMs: timeoutOf(error) };
  }
  // AbortSignal.timeout rejects a fetch with a DOMException named TimeoutError, possibly under a "fetch failed" wrapper.
  if (causeChain(error).some((link) => link.name === "TimeoutError")) {
    return { kind: "timeout", timeoutMs: undefined };
  }
  if (error instanceof Error) {
    return {
      kind: "unclassified",
      chain: causeChain(error).map((link) => toLink(link)),
      isSdkError: error instanceof SdkError,
    };
  }
  return { kind: "other", message: String(error) };
}
