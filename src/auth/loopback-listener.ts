import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { parseCallbackOutcome } from "#core/parse-callback-outcome";
import { renderCallbackPage } from "#core/render-callback-page";

export const LOOPBACK_PORT = 38_417;
const CALLBACK_PATH = "/callback";
// The registered redirect stays on localhost; changing it needs a new Auth0 registration.
export const REDIRECT_URL = `http://localhost:${LOOPBACK_PORT}${CALLBACK_PATH}`;

// The page loads only Google Fonts; the callback URL's code and state must never leave the machine.
const CALLBACK_PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com",
  connection: "close",
} as const;

const LOOPBACK_ADDRESSES = ["127.0.0.1", "::1"] as const;

export type LoopbackListenerOptions = {
  timeoutMs: number;
  expectedState: string;
  port: number;
};

export type LoopbackListener = {
  callback: Promise<URLSearchParams>;
  close: () => void;
};

function displayAddress(host: string, port: number): string {
  return host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
}

function matchesState(received: string | null, expected: string): boolean {
  if (received === null) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function listenOn(server: Server, host: string, port: number): Promise<"listening" | "absent"> {
  return new Promise((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      // A host without IPv6 cannot bind ::1, and then no other process can hold it either.
      if (host === "::1" && (error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT")) {
        resolve("absent");
        return;
      }
      const address = displayAddress(host, port);
      reject(
        error.code === "EADDRINUSE"
          ? new Error(
              `${address} is already in use; valcloud needs port ${port} free on 127.0.0.1 and ::1 for the login callback. Stop whatever is listening on ${address} and retry`,
            )
          : new Error(
              `cannot listen on ${address} for the login callback (${error.code ?? error.message})`,
            ),
      );
    });
    server.listen(port, host, () => {
      resolve("listening");
    });
  });
}

function closeServers(servers: readonly Server[]): void {
  for (const server of servers) {
    server.close();
    server.closeAllConnections();
  }
}

export async function startLoopbackListener(
  options: LoopbackListenerOptions,
): Promise<LoopbackListener> {
  const { timeoutMs, expectedState, port } = options;
  const { promise: callback, resolve, reject } = Promise.withResolvers<URLSearchParams>();
  // A timeout may fire before anyone awaits the callback.
  void Promise.allSettled([callback]);

  function handle(request: IncomingMessage, response: ServerResponse): void {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== CALLBACK_PATH) {
      response.writeHead(404, { connection: "close" }).end();
      return;
    }
    if (!matchesState(url.searchParams.get("state"), expectedState)) {
      response
        .writeHead(400, { "content-type": "text/plain; charset=utf-8", connection: "close" })
        .end("This callback does not belong to the pending valcloud login.\n");
      return;
    }
    response
      .writeHead(200, CALLBACK_PAGE_HEADERS)
      .end(renderCallbackPage(parseCallbackOutcome(url.searchParams)));
    resolve(url.searchParams);
  }

  const servers: Server[] = [];
  try {
    for (const host of LOOPBACK_ADDRESSES) {
      const server = createServer(handle);
      if ((await listenOn(server, host, port)) === "listening") servers.push(server);
    }
  } catch (error) {
    closeServers(servers);
    throw error;
  }

  const timer = setTimeout(() => {
    reject(new Error(`login timed out after ${Math.round(timeoutMs / 60_000)} minutes`));
  }, timeoutMs);

  return {
    callback,
    close() {
      clearTimeout(timer);
      closeServers(servers);
    },
  };
}
