import { isSpecType } from "@modelcontextprotocol/client";
import type { Client, DiscoverResult } from "@modelcontextprotocol/client";
import * as z from "zod";
import { catalogFreshness } from "#core/catalog-cache";
import type { CatalogCache } from "#core/catalog-cache";
import { ToolDefinition } from "#core/tool-definition";
import type { CatalogStore } from "./catalog-store.ts";

type CatalogPolicy = "prefer-fresh" | "prefer-cached" | "refresh";

export type LoadedCatalog = {
  tools: readonly ToolDefinition[];
  discover: DiscoverResult | undefined;
  stale: boolean;
};

type CatalogConnection = { client: Client; principal: string };

export type CatalogRequest = {
  gatewayUrl: string;
  principal: string;
  catalogStore: CatalogStore;
  policy: CatalogPolicy;
  connect: () => Promise<CatalogConnection>;
};

function toLoaded(cache: CatalogCache, stale: boolean): LoadedCatalog {
  return {
    stale,
    tools: cache.tools,
    // oxlint-disable-next-line eslint/new-cap -- SDK type guards are PascalCase properties
    discover: isSpecType.DiscoverResult(cache.discover) ? cache.discover : undefined,
  };
}

export async function refreshCatalogFrom(
  client: Client,
  request: Pick<CatalogRequest, "gatewayUrl" | "principal" | "catalogStore">,
): Promise<LoadedCatalog> {
  const { tools } = await client.listTools();
  const cache: CatalogCache = {
    fetchedAtMs: Date.now(),
    principal: request.principal,
    tools: z.array(ToolDefinition).parse(tools),
    discover: client.getDiscoverResult(),
  };
  await request.catalogStore.write(request.gatewayUrl, cache);
  return toLoaded(cache, false);
}

async function fetchCatalog(request: CatalogRequest): Promise<LoadedCatalog> {
  const { client, principal } = await request.connect();
  try {
    return await refreshCatalogFrom(client, { ...request, principal });
  } finally {
    await client.close();
  }
}

export async function loadCatalog(request: CatalogRequest): Promise<LoadedCatalog> {
  const { policy } = request;
  if (policy === "refresh") return fetchCatalog(request);
  const cached = await request.catalogStore.read(request.gatewayUrl);
  if (cached !== undefined) {
    const freshness = catalogFreshness(cached, Date.now(), request.principal);
    if (freshness === "fresh") return toLoaded(cached, false);
    if (freshness === "stale" && policy === "prefer-cached") return toLoaded(cached, true);
  }
  return fetchCatalog(request);
}
