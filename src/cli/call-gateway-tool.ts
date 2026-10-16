import { ProtocolError } from "@modelcontextprotocol/client";
import type { CallToolResult, Client } from "@modelcontextprotocol/client";
import { buildMcpAuth } from "#auth/resolve-credentials";
import type { Credentials } from "#auth/resolve-credentials";
import { isStaleCatalogRpcCode } from "#core/map-error";
import { connectMcpClient } from "#mcp/connect-mcp-client";
import { refreshCatalogFrom } from "#mcp/load-catalog";
import { principalOfCredentials } from "./build-catalog-request.ts";
import { credentialsForConnect } from "./credentials-for-connect.ts";
import type { ToolInvocation } from "./run-tool-command.ts";
import { toFailure } from "./to-failure.ts";

async function refreshStaleCatalog(
  client: Client,
  invocation: ToolInvocation,
  credentials: Credentials,
): Promise<void> {
  const { context, options } = invocation;
  try {
    await refreshCatalogFrom(client, {
      gatewayUrl: context.gateway.url,
      principal: principalOfCredentials(credentials),
      catalogStore: context.catalogStore,
      requestTimeoutMs: context.requestTimeouts.setupMs,
    });
  } catch (error) {
    // The call already succeeded, so a failed cache refresh is a note on stderr rather than a failure.
    if (options.json === true) return;
    const { message } = toFailure(error, context.failureContext);
    context.stderr(`valcloud: note: could not refresh the cached tool list (${message})\n`);
  }
}

export async function callGatewayTool(
  invocation: ToolInvocation,
  toolArguments: Record<string, unknown> | undefined,
): Promise<CallToolResult> {
  const { spec, context, catalog } = invocation;
  const { gateway } = context;
  const credentials = await credentialsForConnect(context);
  const auth = buildMcpAuth(
    credentials,
    gateway,
    context.credentialStore,
    context.requestTimeouts.refreshMs,
  );
  const { client } = await connectMcpClient(
    gateway.url,
    auth,
    catalog.discover,
    context.requestTimeouts.setupMs,
  );
  try {
    let result;
    try {
      result = await client.callTool(
        { name: spec.toolName, arguments: toolArguments },
        { timeout: context.requestTimeouts.toolCallMs },
      );
    } catch (error) {
      if (error instanceof ProtocolError && isStaleCatalogRpcCode(error.code)) {
        await context.catalogStore.remove(gateway.url);
      }
      throw error;
    }
    if (catalog.stale) await refreshStaleCatalog(client, invocation, credentials);
    return result;
  } finally {
    await client.close();
  }
}
