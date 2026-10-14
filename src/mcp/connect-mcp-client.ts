import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type {
  AuthProvider,
  DiscoverResult,
  OAuthClientProvider,
} from "@modelcontextprotocol/client";
import { packageInfo } from "#shared/package-info";

export type McpAuth =
  | { kind: "static"; token: string }
  | { kind: "provider"; provider: AuthProvider | OAuthClientProvider };

export type McpConnection = {
  client: Client;
  transport: StreamableHTTPClientTransport;
};

// Pinning the modern revision makes connect() send server/discover and fail loudly instead of falling back to sessions.
const PINNED_PROTOCOL_VERSION = "2026-07-28";

export function createMcpConnection(url: string, auth: McpAuth): McpConnection {
  const authProvider =
    auth.kind === "static" ? { token: () => Promise.resolve(auth.token) } : auth.provider;
  const client = new Client(
    { name: "vcloud", version: packageInfo.version },
    { versionNegotiation: { mode: { pin: PINNED_PROTOCOL_VERSION } } },
  );
  const transport = new StreamableHTTPClientTransport(new URL(url), { authProvider });
  return { client, transport };
}

export async function connectMcpClient(
  url: string,
  auth: McpAuth,
  prior: DiscoverResult | undefined,
): Promise<McpConnection> {
  const connection = createMcpConnection(url, auth);
  await connection.client.connect(
    connection.transport,
    prior === undefined ? undefined : { prior: { kind: "modern", discover: prior } },
  );
  return connection;
}
