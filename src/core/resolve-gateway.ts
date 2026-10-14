import { err, ok } from "./result.ts";
import type { Result } from "./result.ts";

const BUILT_IN_GATEWAY_URL = "https://mcp.validationcloud.io/mcp";

// The normalised URL doubles as the key for stored credentials and the catalog cache.
export type ResolvedGateway = {
  url: string;
};

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

function validateUrlOverride(raw: string): Result<string> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return err("VC_MCP_URL is not a valid URL");
  }
  if (url.username !== "" || url.password !== "") {
    return err("VC_MCP_URL must not contain credentials (user:password@)");
  }
  const isLoopbackHttp = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !isLoopbackHttp) {
    return err("VC_MCP_URL must use https (http is allowed only for localhost)");
  }
  return ok(url.toString());
}

export function resolveGateway(urlOverride: string | undefined): Result<ResolvedGateway> {
  if (urlOverride === undefined || urlOverride === "") {
    return ok({ url: new URL(BUILT_IN_GATEWAY_URL).toString() });
  }
  const url = validateUrlOverride(urlOverride);
  if (!url.ok) return url;
  return ok({ url: url.value });
}
