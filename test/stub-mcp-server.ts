import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createStubMcpServer } from "./create-stub-mcp-server.ts";
import type { StubMode } from "./create-stub-mcp-server.ts";

export type RecordedRequest = {
  rpcMethod: string;
  toolName: string | undefined;
  arguments: unknown;
};

export type StubMcpServer = {
  url: string;
  token: string;
  requests: RecordedRequest[];
  setMode: (mode: StubMode) => void;
  close: () => Promise<void>;
};

const TOKEN = "stub-token";

function toWebRequest(incoming: IncomingMessage, body: Buffer): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (value !== undefined) for (const item of value) headers.append(name, item);
  }
  const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD" && body.length > 0;
  return new Request(`http://${incoming.headers.host}${incoming.url}`, {
    method: incoming.method,
    headers,
    body: hasBody ? new Uint8Array(body) : undefined,
  });
}

function record(requests: RecordedRequest[], body: string): void {
  try {
    const message = JSON.parse(body) as {
      method?: string;
      params?: { name?: string; arguments?: unknown };
    };
    if (typeof message.method !== "string") return;
    requests.push({
      rpcMethod: message.method,
      toolName: message.params?.name,
      arguments: message.params?.arguments,
    });
  } catch {
    // Not JSON: nothing to record.
  }
}

async function readBody(incoming: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

export async function startStubMcpServer(): Promise<StubMcpServer> {
  let mode: StubMode = "ok";
  const handler = createMcpHandler(() => createStubMcpServer(mode), { legacy: "reject" });
  const requests: RecordedRequest[] = [];

  async function serve(incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> {
    const body = await readBody(incoming);
    if (mode === "unavailable") {
      outgoing.writeHead(503, { "content-type": "text/plain" });
      outgoing.end("service unavailable");
      return;
    }
    if (incoming.headers.authorization !== `Bearer ${TOKEN}`) {
      outgoing.writeHead(401, { "www-authenticate": "Bearer", "content-type": "text/plain" });
      outgoing.end("unauthorized");
      return;
    }
    record(requests, body.toString("utf8"));
    const response = await handler.fetch(toWebRequest(incoming, body));
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  }

  const httpServer = createServer((incoming, outgoing) => {
    void serve(incoming, outgoing);
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });
  const { port } = httpServer.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    token: TOKEN,
    requests,
    setMode: (next) => {
      mode = next;
    },
    close: async () => {
      await handler.close();
      httpServer.closeAllConnections();
      await closeServer(httpServer);
    },
  };
}
