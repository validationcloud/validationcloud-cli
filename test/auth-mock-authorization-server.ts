import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import {
  authorizationServerMetadata,
  protectedResourceMetadata,
} from "./mock-authorization-metadata.ts";
import { readBody, sendJson } from "./http-json.ts";
import { createGate } from "./create-gate.ts";
import type { Gate } from "./create-gate.ts";

type TokenRequest = { grantType: string | null; refreshToken: string | null };

export type MockAuthorizationServerOptions = {
  // Holding a valid refresh briefly lets a concurrent reuse of the same token arrive meanwhile.
  refreshDelayMs: number;
  // Answering a reused token late lets the winner save its rotated tokens first.
  reuseDelayMs: number;
  // When set, the gateway endpoint /mcp answers 401 with a pointer to this server once the test releases `gateway`; otherwise it is a 404.
  gatedGateway?: boolean;
  // When set, a valid refresh is answered only once the test releases `refresh`, in addition to refreshDelayMs.
  gatedRefresh?: boolean;
};

export type MockAuthorizationServer = {
  mcpUrl: string;
  issuer: string;
  tokenRequests: TokenRequest[];
  registrations: number[];
  gateway: Gate;
  refresh: Gate;
  acceptRefreshToken: (token: string) => void;
  failTokenRequests: (status: 500 | undefined) => void;
  close: () => Promise<void>;
};

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
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
  const gateway = createGate();
  const refresh = createGate();

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
    if (options.gatedRefresh === true) await refresh.hold();
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

  async function rejectGatewayRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    await readBody(request);
    await gateway.hold();
    response
      .writeHead(401, {
        "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
      })
      .end();
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", base);
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
      sendJson(response, 200, protectedResourceMetadata(base));
      return;
    }
    if (
      url.pathname.startsWith("/.well-known/oauth-authorization-server") ||
      url.pathname.startsWith("/.well-known/openid-configuration")
    ) {
      sendJson(response, 200, authorizationServerMetadata(base));
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
    if (url.pathname === "/mcp" && options.gatedGateway === true) {
      void rejectGatewayRequest(request, response);
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
    gateway,
    refresh,
    acceptRefreshToken(refreshToken) {
      validRefreshTokens.add(refreshToken);
    },
    failTokenRequests(status) {
      failureStatus = status;
    },
    async close() {
      gateway.release();
      refresh.release();
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}
