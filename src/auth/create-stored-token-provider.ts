import type { AuthProvider } from "@modelcontextprotocol/client";
import type { CredentialStore } from "./credential-store.ts";
import { refreshStoredCredentials } from "./refresh-stored-credentials.ts";
import type { ResolvedGateway } from "#core/resolve-gateway";

// A 401 refreshes under the credentials lock, so processes that all hit it never reuse one rotated refresh token.
export function createStoredTokenProvider(
  gateway: ResolvedGateway,
  store: CredentialStore,
  refreshTimeoutMs: number,
): AuthProvider {
  let lastToken: string | undefined;
  return {
    async token() {
      const entry = await store.read(gateway.url);
      lastToken = entry?.tokens?.access_token;
      return lastToken;
    },
    async onUnauthorized() {
      await refreshStoredCredentials(gateway, store, {
        rejectedAccessToken: lastToken,
        requestTimeoutMs: refreshTimeoutMs,
      });
    },
  };
}
