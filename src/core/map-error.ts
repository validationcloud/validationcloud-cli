import { authHint } from "./auth-hint.ts";
import type { AuthHintContext } from "./auth-hint.ts";
import { createFailure } from "./cli-failure.ts";
import type { CliFailure } from "./cli-failure.ts";
import { FailureKind } from "./exit-codes.ts";
import type { EnvProxy } from "./describe-env-proxy.ts";

export type ErrorFacts =
  | { kind: "login-required" }
  | { kind: "http-unauthorized" }
  | { kind: "http-status"; status: number; message: string }
  | { kind: "oauth"; code: string }
  | { kind: "refresh-unavailable"; detail: string }
  | { kind: "network"; detail: string }
  | { kind: "timeout"; timeoutMs: number | undefined }
  | { kind: "protocol"; rpcCode: number; message: string }
  | { kind: "other"; message: string }
  | { kind: "unclassified"; chain: readonly ErrorLink[]; isSdkError: boolean };

export type ErrorLink = { message: string; code: string | undefined; isFetchFailure: boolean };

export type ErrorMappingContext = AuthHintContext & {
  gatewayUrl: string;
  proxy: EnvProxy | undefined;
};

const NETWORK_ERROR_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const REJECTED_OAUTH_CODES: ReadonlySet<string> = new Set(["invalid_grant", "invalid_client"]);

const STALE_CATALOG_RPC_CODES: ReadonlySet<number> = new Set([-32_601, -32_602]);

export function isStaleCatalogRpcCode(rpcCode: number): boolean {
  return STALE_CATALOG_RPC_CODES.has(rpcCode);
}

function authFailure(context: AuthHintContext, detail: string): CliFailure {
  const subject = context.usesStaticToken
    ? "the gateway rejected VC_TOKEN"
    : "authentication failed";
  return createFailure(FailureKind.auth, `${subject} (${detail})`, authHint(context));
}

function networkDetail(chain: readonly ErrorLink[]): string | undefined {
  const isNetwork = chain.some(
    (link) => link.isFetchFailure || NETWORK_ERROR_CODES.has(link.code ?? ""),
  );
  const innermost = chain.at(-1);
  if (!isNetwork || innermost === undefined) return undefined;
  return innermost.code ?? (innermost.message === "" ? "network error" : innermost.message);
}

function proxyHint(proxy: EnvProxy): string {
  const where = proxy.origin === undefined ? proxy.variable : `${proxy.variable} (${proxy.origin})`;
  return `the proxy set in ${where} is the likely cause: check that it can reach the gateway, or unset it`;
}

function networkFailure(detail: string, context: ErrorMappingContext): CliFailure {
  return createFailure(
    FailureKind.runtime,
    `cannot reach ${context.gatewayUrl} (${detail})`,
    context.proxy === undefined
      ? "check your network, or set VC_MCP_URL to another gateway"
      : proxyHint(context.proxy),
  );
}

function describeDuration(milliseconds: number): string {
  return milliseconds % 1000 === 0 ? `${milliseconds / 1000} s` : `${milliseconds} ms`;
}

function timeoutFailure(timeoutMs: number | undefined, context: ErrorMappingContext): CliFailure {
  const within = timeoutMs === undefined ? "in time" : `within ${describeDuration(timeoutMs)}`;
  const slow = "if the call is slow rather than stuck, raise VC_REQUEST_TIMEOUT_MS";
  return createFailure(
    FailureKind.runtime,
    `no response from ${context.gatewayUrl} ${within}`,
    context.proxy === undefined
      ? `check your network; ${slow}`
      : `${proxyHint(context.proxy)}; ${slow}`,
  );
}

function unclassifiedFailure(
  chain: readonly ErrorLink[],
  isSdkError: boolean,
  context: ErrorMappingContext,
): CliFailure {
  const detail = networkDetail(chain);
  if (detail !== undefined) return networkFailure(detail, context);
  const [error, cause] = chain;
  if (error === undefined) return createFailure(FailureKind.runtime, "unknown error");
  const withCause = !isSdkError && cause !== undefined && cause.message !== "";
  return createFailure(
    FailureKind.runtime,
    withCause ? `${error.message}: ${cause.message}` : error.message,
  );
}

function refreshUnavailableFailure(detail: string, context: ErrorMappingContext): CliFailure {
  return createFailure(
    FailureKind.runtime,
    `could not refresh the session (${detail}); stored credentials are intact`,
    context.proxy === undefined ? "try again in a moment" : proxyHint(context.proxy),
  );
}

function protocolFailure(rpcCode: number, message: string): CliFailure {
  const staleCatalog = isStaleCatalogRpcCode(rpcCode);
  return {
    kind: FailureKind.runtime,
    code: "protocol_error",
    message: `${message} (JSON-RPC error ${rpcCode})`,
    hint: staleCatalog
      ? "the tool list may be out of date; run 'valcloud tools --refresh' and retry"
      : undefined,
    retryAfterSeconds: undefined,
    rpcCode,
  };
}

export function mapErrorFacts(facts: ErrorFacts, context: ErrorMappingContext): CliFailure {
  switch (facts.kind) {
    case "login-required": {
      return authFailure(context, "session expired or missing");
    }
    case "http-unauthorized": {
      return authFailure(context, "HTTP 401");
    }
    case "oauth": {
      if (!REJECTED_OAUTH_CODES.has(facts.code)) {
        return refreshUnavailableFailure(`OAuth error ${facts.code}`, context);
      }
      return authFailure(context, `the authorization server rejected the session: ${facts.code}`);
    }
    case "http-status": {
      return createFailure(
        FailureKind.runtime,
        `the gateway answered HTTP ${facts.status}: ${facts.message}`,
      );
    }
    case "refresh-unavailable": {
      return refreshUnavailableFailure(facts.detail, context);
    }
    case "network": {
      return networkFailure(facts.detail, context);
    }
    case "timeout": {
      return timeoutFailure(facts.timeoutMs, context);
    }
    case "protocol": {
      return protocolFailure(facts.rpcCode, facts.message);
    }
    case "other": {
      return createFailure(FailureKind.runtime, facts.message);
    }
    case "unclassified": {
      return unclassifiedFailure(facts.chain, facts.isSdkError, context);
    }
  }
}
