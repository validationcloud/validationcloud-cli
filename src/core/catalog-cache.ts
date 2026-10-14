import * as z from "zod";
import { ToolDefinition } from "./tool-definition.ts";

const CATALOG_TTL_MS = 60 * 60 * 1000;

export const CatalogCache = z.object({
  fetchedAtMs: z.number(),
  principal: z.string(),
  tools: z.array(ToolDefinition),
  discover: z.unknown(),
});

export type CatalogCache = z.infer<typeof CatalogCache>;

export type CatalogFreshness = "fresh" | "stale" | "foreign";

export function catalogFreshness(
  cache: Pick<CatalogCache, "fetchedAtMs" | "principal">,
  nowMs: number,
  principal: string,
): CatalogFreshness {
  if (cache.principal !== principal) return "foreign";
  return nowMs - cache.fetchedAtMs < CATALOG_TTL_MS ? "fresh" : "stale";
}
