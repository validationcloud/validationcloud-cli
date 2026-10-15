import { createServer } from "node:net";
import type { Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { startLoopbackListener } from "#auth/loopback-listener";
import type { LoopbackListener } from "#auth/loopback-listener";

const EXPECTED_STATE = "expected-state-value";

let listener: LoopbackListener | undefined;
let blocker: Server | undefined;

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      resolve();
    });
  });
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await listen(probe, "127.0.0.1", 0);
  const address = probe.address();
  await new Promise<void>((resolve) => {
    probe.close(() => {
      resolve();
    });
  });
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

async function start(port: number): Promise<LoopbackListener> {
  listener = await startLoopbackListener({
    timeoutMs: 60_000,
    expectedState: EXPECTED_STATE,
    port,
  });
  return listener;
}

async function get(url: string): Promise<{ status: number; body: string }> {
  const response = await fetch(url);
  return { status: response.status, body: await response.text() };
}

async function getResponse(url: string): Promise<{ response: Response; body: string }> {
  const response = await fetch(url);
  return { response, body: await response.text() };
}

afterEach(async () => {
  listener?.close();
  listener = undefined;
  const current = blocker;
  blocker = undefined;
  if (current !== undefined) {
    await new Promise<void>((resolve) => {
      current.close(() => {
        resolve();
      });
    });
  }
});

describe("login loopback listener", () => {
  it("answers a forged state with 400 without echoing it and keeps waiting", async () => {
    const port = await freePort();
    const { callback } = await start(port);

    await expect(
      get(`http://127.0.0.1:${port}/callback?code=evil&state=%3Cscript%3Eforged`),
    ).resolves.toStrictEqual({
      status: 400,
      body: "This callback does not belong to the pending valcloud login.\n",
    });
    await expect(get(`http://127.0.0.1:${port}/callback?code=evil`)).resolves.toStrictEqual({
      status: 400,
      body: "This callback does not belong to the pending valcloud login.\n",
    });
    const { status, body } = await get(
      `http://127.0.0.1:${port}/callback?code=good&state=${EXPECTED_STATE}`,
    );
    expect(status).toBe(200);
    expect(body).toContain("<h1>You're logged in to Validation Cloud</h1>");
    const params = await callback;
    expect(params.get("code")).toBe("good");
  });

  it("serves the page with headers that keep the callback URL from leaking", async () => {
    const port = await freePort();
    const { callback } = await start(port);
    const { response } = await getResponse(
      `http://127.0.0.1:${port}/callback?code=good&state=${EXPECTED_STATE}`,
    );
    await callback;

    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com",
    );
  });

  it("resolves on an error callback that carries the expected state", async () => {
    const port = await freePort();
    const { callback } = await start(port);
    const { body } = await get(
      `http://127.0.0.1:${port}/callback?error=access_denied&error_description=%3Cb%3Eno%3C%2Fb%3E&state=${EXPECTED_STATE}`,
    );
    const params = await callback;

    expect(params.get("error")).toBe("access_denied");
    expect(body).toContain("<h1>Login was not completed</h1>");
    expect(body).toContain("<code>access_denied</code>");
    expect(body).toContain('<p class="detail">&lt;b&gt;no&lt;/b&gt;</p>');
  });

  it("ignores an error callback with a forged state", async () => {
    const port = await freePort();
    const { callback } = await start(port);

    await expect(
      get(`http://127.0.0.1:${port}/callback?error=access_denied&state=forged`),
    ).resolves.toStrictEqual({
      status: 400,
      body: "This callback does not belong to the pending valcloud login.\n",
    });
    await get(`http://127.0.0.1:${port}/callback?code=good&state=${EXPECTED_STATE}`);
    const params = await callback;
    expect(params.get("code")).toBe("good");
  });

  it("accepts the callback on ::1 as well", async () => {
    const port = await freePort();
    const { callback } = await start(port);
    await get(`http://[::1]:${port}/callback?code=ipv6&state=${EXPECTED_STATE}`);
    const params = await callback;

    expect(params.get("code")).toBe("ipv6");
  });

  it("fails naming 127.0.0.1 when another process holds it", async () => {
    const port = await freePort();
    blocker = createServer();
    await listen(blocker, "127.0.0.1", port);

    await expect(start(port)).rejects.toThrow(
      /^127\.0\.0\.1:\d+ is already in use; valcloud needs port \d+ free on 127\.0\.0\.1 and ::1 for the login callback/u,
    );
  });

  it("fails naming [::1] when another process holds it and releases 127.0.0.1", async () => {
    const port = await freePort();
    blocker = createServer();
    await listen(blocker, "::1", port);

    await expect(start(port)).rejects.toThrow(/^\[::1\]:\d+ is already in use/u);
    const probe = createServer();
    await listen(probe, "127.0.0.1", port);
    await new Promise<void>((resolve) => {
      probe.close(() => {
        resolve();
      });
    });
  });
});
