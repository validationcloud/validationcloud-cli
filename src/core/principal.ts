import { createHash } from "node:crypto";
import { decodeJwtClaims } from "./decode-jwt-claims.ts";

// A token without a readable subject is keyed by its hash, so two such tokens never share a catalog cache.
export function derivePrincipal(accessToken: string | undefined): string {
  if (accessToken === undefined) return "anonymous";
  const subject = decodeJwtClaims(accessToken).sub;
  if (subject !== undefined) return subject;
  return `sha256:${createHash("sha256").update(accessToken).digest("hex")}`;
}
