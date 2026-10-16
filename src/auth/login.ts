import { UnauthorizedError } from "@modelcontextprotocol/client";
import type { CredentialStore } from "./credential-store.ts";
import { LOOPBACK_PORT, startLoopbackListener } from "./loopback-listener.ts";
import { openBrowser } from "./open-browser.ts";
import { VcOAuthProvider } from "./vc-oauth-provider.ts";
import { createMcpConnection } from "#mcp/connect-mcp-client";
import { parseBrowserUrl } from "#core/parse-browser-url";
import type { ResolvedGateway } from "#core/resolve-gateway";

const LOGIN_TIMEOUT_MS = 5 * 60_000;

export type LoginOptions = {
  gateway: ResolvedGateway;
  store: CredentialStore;
  launchBrowser: boolean;
  requestTimeoutMs: number;
  tell: (text: string) => void;
};

export async function runLogin(options: LoginOptions): Promise<void> {
  const { gateway, store, tell } = options;
  const provider = new VcOAuthProvider({
    store,
    key: gateway.url,
    ignoreStoredTokens: true,
    onRedirect: async (authorizationUrl) => {
      const parsed = parseBrowserUrl(authorizationUrl.href);
      if (!parsed.ok) throw new Error(parsed.error);
      tell(`Open this URL to sign in to ${gateway.url}:\n${parsed.value.href}\n`);
      if (!options.launchBrowser) return;
      if (!(await openBrowser(parsed.value.href))) {
        tell("Could not open a browser; open the URL above yourself.\n");
      }
    },
  });
  const listener = await startLoopbackListener({
    timeoutMs: LOGIN_TIMEOUT_MS,
    expectedState: provider.state(),
    port: LOOPBACK_PORT,
  });
  try {
    const { client, transport } = createMcpConnection(gateway.url, {
      kind: "provider",
      provider,
    });

    try {
      await client.connect(transport, { timeout: options.requestTimeoutMs });
      await client.listTools(undefined, { timeout: options.requestTimeoutMs });
      throw new Error("the gateway did not ask for authorization");
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) throw error;
    }

    const params = await listener.callback;
    const refusal = params.get("error");
    if (refusal !== null) {
      throw new Error(
        `the authorization server refused the login: ${refusal.replaceAll(/[^\w.-]/gu, "")}`,
      );
    }
    await transport.finishAuth(params);
    await client.close();
  } finally {
    listener.close();
  }
}
