import { buildMcpAuth } from "#auth/resolve-credentials";
import type { Credentials } from "#auth/resolve-credentials";
import { derivePrincipal } from "#core/principal";
import { connectMcpClient } from "#mcp/connect-mcp-client";
import type { CatalogRequest } from "#mcp/load-catalog";
import type { CliContext } from "./cli-context.ts";

type CatalogRequestInput = {
  credentials: Credentials;
  policy: CatalogRequest["policy"];
  connectionCredentials: () => Promise<Credentials>;
};

export function principalOfCredentials(credentials: Credentials): string {
  return derivePrincipal(credentials.source === "none" ? undefined : credentials.accessToken);
}

export function buildCatalogRequest(
  context: CliContext,
  input: CatalogRequestInput,
): CatalogRequest {
  const { gateway, credentialStore, catalogStore } = context;
  return {
    gatewayUrl: gateway.url,
    principal: principalOfCredentials(input.credentials),
    catalogStore,
    policy: input.policy,
    connect: async () => {
      const credentials = await input.connectionCredentials();
      const auth = buildMcpAuth(credentials, gateway, credentialStore);
      const { client } = await connectMcpClient(gateway.url, auth, undefined);
      return { client, principal: principalOfCredentials(credentials) };
    },
  };
}
