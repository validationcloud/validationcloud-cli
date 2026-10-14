import type { CredentialEntry, CredentialStore } from "./credential-store.ts";
import { notLoggedIn } from "./not-logged-in.ts";
import { createStoredTokenProvider } from "./create-stored-token-provider.ts";
import type { McpAuth } from "#mcp/connect-mcp-client";
import type { ResolvedGateway } from "#core/resolve-gateway";

export type Credentials =
  | { source: "VC_TOKEN"; accessToken: string }
  | { source: "stored"; accessToken: string; entry: CredentialEntry }
  | { source: "none" };

export async function resolveCredentials(
  gateway: ResolvedGateway,
  vcToken: string | undefined,
  store: CredentialStore,
): Promise<Credentials> {
  if (vcToken !== undefined && vcToken !== "") return { source: "VC_TOKEN", accessToken: vcToken };
  const entry = await store.read(gateway.url);
  if (entry?.tokens === undefined) return { source: "none" };
  return { source: "stored", accessToken: entry.tokens.access_token, entry };
}

export function buildMcpAuth(
  credentials: Credentials,
  gateway: ResolvedGateway,
  store: CredentialStore,
): McpAuth {
  if (credentials.source === "none") throw notLoggedIn(gateway);
  if (credentials.source === "VC_TOKEN") return { kind: "static", token: credentials.accessToken };
  return { kind: "provider", provider: createStoredTokenProvider(gateway, store) };
}
