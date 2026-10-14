export type JwtClaims = { sub: string | undefined; exp: number | undefined };

const NO_CLAIMS: JwtClaims = { sub: undefined, exp: undefined };

export function decodeJwtClaims(token: string): JwtClaims {
  const parts = token.split(".");
  const [, payload] = parts;
  if (parts.length !== 3 || payload === undefined) return NO_CLAIMS;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof claims !== "object" || claims === null) return NO_CLAIMS;
    const sub = "sub" in claims && typeof claims.sub === "string" ? claims.sub : undefined;
    const exp = "exp" in claims && typeof claims.exp === "number" ? claims.exp : undefined;
    return { sub, exp };
  } catch {
    return NO_CLAIMS;
  }
}
