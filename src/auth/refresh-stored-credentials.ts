import { auth } from "@modelcontextprotocol/client";
import type { FetchLike } from "@modelcontextprotocol/client";
import type { CredentialStore } from "./credential-store.ts";
import type { Credentials } from "./resolve-credentials.ts";
import { notLoggedIn } from "./not-logged-in.ts";
import { VcOAuthProvider } from "./vc-oauth-provider.ts";
import type { ResolvedGateway } from "#core/resolve-gateway";
import { isExpired, resolveTokenExpiry } from "#core/token-expiry";

export type StoredCredentials = Extract<Credentials, { source: "stored" }>;

export type RefreshOptions = {
  // The access token the gateway answered 401 for; undefined when the token merely looks expired.
  rejectedAccessToken: string | undefined;
  // Bounds every request of the refresh, because the credentials lock is held meanwhile.
  requestTimeoutMs: number;
};

function fetchWithTimeout(timeoutMs: number): FetchLike {
  return (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

export async function refreshStoredCredentials(
  gateway: ResolvedGateway,
  store: CredentialStore,
  options: RefreshOptions,
): Promise<StoredCredentials> {
  const { url: gatewayUrl } = gateway;
  const { rejectedAccessToken, requestTimeoutMs } = options;
  return store.withLock(async () => {
    const entry = await store.read(gatewayUrl);
    if (entry?.tokens === undefined) throw notLoggedIn(gateway);
    const expiry = resolveTokenExpiry({
      accessToken: entry.tokens.access_token,
      savedAtMs: entry.tokensSavedAtMs,
      expiresInSeconds: entry.tokens.expires_in,
    });
    // Another process may have refreshed while this one waited for the lock.
    const rotatedElsewhere =
      rejectedAccessToken !== undefined && entry.tokens.access_token !== rejectedAccessToken;
    const stillValid = rejectedAccessToken === undefined && !isExpired(expiry, Date.now());
    if (rotatedElsewhere || stillValid) {
      return { source: "stored", accessToken: entry.tokens.access_token, entry };
    }

    const provider = new VcOAuthProvider({
      store,
      key: gatewayUrl,
      onRedirect: undefined,
      ignoreStoredTokens: false,
    });
    await auth(provider, {
      serverUrl: new URL(gateway.url),
      fetchFn: fetchWithTimeout(requestTimeoutMs),
    });
    const refreshed = await store.read(gatewayUrl);
    if (refreshed?.tokens === undefined) throw notLoggedIn(gateway);
    return { source: "stored", accessToken: refreshed.tokens.access_token, entry: refreshed };
  });
}
