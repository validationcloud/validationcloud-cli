import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

type TokenRequest = { grantType: string | null; refreshToken: string | null };

export type MockAuthorizationServerOptions = {
  // Holding a valid refresh briefly lets a concurrent reuse of the same token arrive meanwhile.
  refreshDelayMs: number;
  // Answering a reused token late lets the winner save its rotated tokens first.
  reuseDelayMs: number;
};

export type MockAuthorizationServer = {
  mcpUrl: string;
  issuer: string;
  tokenRequests: TokenRequest[];
  registrations: number[];
  acceptRefreshToken: (token: string) => void;
  failTokenRequests: (status: 500 | undefined) => void;
  close: () => Promise<void>;
};

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

export async function startMockAuthorizationServer(
  options: MockAuthorizationServerOptions,
): Promise<MockAuthorizationServer> {
  const validRefreshTokens = new Set<string>();
  const tokenRequests: TokenRequest[] = [];
  const registrations: number[] = [];
  let issued = 0;
  let failureStatus: 500 | undefined;
  let base = "";

  async function token(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const params = new URLSearchParams(await readBody(request));
    const refreshToken = params.get("refresh_token");
    tokenRequests.push({ grantType: params.get("grant_type"), refreshToken });
    if (failureStatus !== undefined) {
      sendJson(response, failureStatus, {
        message: "upstream exploded",
        refresh_token: refreshToken,
      });
      return;
    }
    if (refreshToken === null || !validRefreshTokens.delete(refreshToken)) {
      await sleep(options.reuseDelayMs);
      sendJson(response, 400, {
        error: "invalid_grant",
        error_description: "refresh token reused",
      });
      return;
    }
    await sleep(options.refreshDelayMs);
    issued += 1;
    const rotated = `rt-${issued}`;
    validRefreshTokens.add(rotated);
    sendJson(response, 200, {
      access_token: `${base64url({ alg: "none" })}.${base64url({ sub: "user-1", exp: Math.floor(Date.now() / 1000) + 3600, n: issued })}.sig`,
      token_type: "Bearer",
      refresh_token: rotated,
      expires_in: 3600,
    });
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", base);
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
      sendJson(response, 200, {
        resource: `${base}/mcp`,
        authorization_servers: [base],
        scopes_supported: ["openid", "profile", "email"],
      });
      return;
    }
    if (
      url.pathname.startsWith("/.well-known/oauth-authorization-server") ||
      url.pathname.startsWith("/.well-known/openid-configuration")
    ) {
      sendJson(response, 200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        scopes_supported: ["openid", "profile", "email", "offline_access"],
        token_endpoint_auth_methods_supported: ["none"],
      });
      return;
    }
    if (url.pathname === "/register") {
      registrations.push(registrations.length + 1);
      sendJson(response, 201, { client_id: `registered-${registrations.length}` });
      return;
    }
    if (url.pathname === "/token") {
      void token(request, response);
      return;
    }
    response.writeHead(404).end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    mcpUrl: `${base}/mcp`,
    issuer: base,
    tokenRequests,
    registrations,
    acceptRefreshToken(refreshToken) {
      validRefreshTokens.add(refreshToken);
    },
    failTokenRequests(status) {
      failureStatus = status;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}
