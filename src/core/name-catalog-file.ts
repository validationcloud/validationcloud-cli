import { createHash } from "node:crypto";

// A URL is not a safe file name, so the name carries a short, stable digest of the normalised gateway URL.
export function nameCatalogFile(gatewayUrl: string): string {
  return `catalog-${createHash("sha256").update(gatewayUrl).digest("hex").slice(0, 16)}.json`;
}
