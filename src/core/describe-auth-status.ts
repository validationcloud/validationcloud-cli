import type { ResolvedGateway } from "./resolve-gateway.ts";
import { decodeJwtClaims } from "./decode-jwt-claims.ts";
import { isExpired, resolveTokenExpiry } from "./token-expiry.ts";
import type { TokenTiming } from "./token-expiry.ts";

type CredentialSource = "stored" | "VC_TOKEN" | "none";

export type AuthStatus = {
  url: string;
  logged_in: boolean;
  verified: boolean;
  source: CredentialSource;
  subject: string | null;
  expires_at: string | null;
  expired: boolean | null;
  refreshable: boolean;
};

export type AuthStatusInput = {
  gateway: ResolvedGateway;
  source: CredentialSource;
  timing: TokenTiming | undefined;
  refreshable: boolean;
  nowMs: number;
};

export function describeAuthStatus(input: AuthStatusInput): AuthStatus {
  const base = {
    url: input.gateway.url,
    source: input.source,
    refreshable: input.refreshable,
  };
  if (input.timing === undefined) {
    return {
      ...base,
      logged_in: false,
      verified: false,
      subject: null,
      expires_at: null,
      expired: null,
    };
  }
  const expiryMs = resolveTokenExpiry(input.timing);
  const expired = expiryMs === undefined ? null : isExpired(expiryMs, input.nowMs);
  return {
    ...base,
    logged_in: expired !== true || input.refreshable,
    verified: expiryMs !== undefined,
    subject: decodeJwtClaims(input.timing.accessToken).sub ?? null,
    expires_at: expiryMs === undefined ? null : new Date(expiryMs).toISOString(),
    expired,
  };
}
