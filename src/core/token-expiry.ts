import { decodeJwtClaims } from "./decode-jwt-claims.ts";

const EXPIRY_SKEW_MS = 30_000;

export type TokenTiming = {
  accessToken: string;
  savedAtMs: number | undefined;
  expiresInSeconds: number | undefined;
};

export function resolveTokenExpiry(timing: TokenTiming): number | undefined {
  const { exp } = decodeJwtClaims(timing.accessToken);
  if (exp !== undefined) return exp * 1000;
  if (timing.savedAtMs === undefined || timing.expiresInSeconds === undefined) return undefined;
  return timing.savedAtMs + timing.expiresInSeconds * 1000;
}

export function isExpired(expiryMs: number | undefined, nowMs: number): boolean {
  return expiryMs !== undefined && expiryMs - EXPIRY_SKEW_MS <= nowMs;
}
