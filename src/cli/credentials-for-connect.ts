import { refreshStoredCredentials } from "#auth/refresh-stored-credentials";
import type { Credentials } from "#auth/resolve-credentials";
import { isExpired, resolveTokenExpiry } from "#core/token-expiry";
import type { CliContext } from "./cli-context.ts";

// An expired stored token is refreshed under the credentials lock before connecting, so concurrent processes never reuse a rotated refresh token.
export async function credentialsForConnect(context: CliContext): Promise<Credentials> {
  const credentials = await context.credentials();
  if (credentials.source !== "stored") return credentials;
  const expiry = resolveTokenExpiry({
    accessToken: credentials.accessToken,
    savedAtMs: credentials.entry.tokensSavedAtMs,
    expiresInSeconds: credentials.entry.tokens?.expires_in,
  });
  if (!isExpired(expiry, Date.now())) return credentials;
  return refreshStoredCredentials(context.gateway, context.credentialStore, {
    rejectedAccessToken: undefined,
    requestTimeoutMs: undefined,
  });
}
