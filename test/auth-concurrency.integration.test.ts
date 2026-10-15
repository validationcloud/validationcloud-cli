import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withSdkConsoleCaptured } from "#auth/capture-sdk-console";
import { createCredentialStore } from "#auth/credential-store";
import { RefreshFailedError } from "#auth/refresh-failed-error";
import { refreshStoredCredentials } from "#auth/refresh-stored-credentials";
import { startMockAuthorizationServer } from "./auth-mock-authorization-server.ts";
import type { MockAuthorizationServer } from "./auth-mock-authorization-server.ts";
import { spawnWorker } from "./auth-spawn-worker.ts";

// Payload {"exp":1}: expired long ago.
const EXPIRED_ACCESS_TOKEN = "h.eyJleHAiOjF9.s";
// Payload {"exp":9999999999}: valid locally, yet the gateway may still answer 401.
const UNEXPIRED_ACCESS_TOKEN = "h.eyJleHAiOjk5OTk5OTk5OTl9.s";

let directory: string;
let credentialsPath: string;
let server: MockAuthorizationServer | undefined;

async function seedCredentials(mock: MockAuthorizationServer, accessToken: string): Promise<void> {
  mock.acceptRefreshToken("rt-seed");
  await createCredentialStore(credentialsPath).update(mock.mcpUrl, () => ({
    client: { client_id: "cli-client", issuer: mock.issuer },
    tokens: {
      access_token: accessToken,
      token_type: "Bearer",
      refresh_token: "rt-seed",
      issuer: mock.issuer,
    },
    tokensSavedAtMs: 0,
  }));
}

function seedExpiredCredentials(mock: MockAuthorizationServer): Promise<void> {
  return seedCredentials(mock, EXPIRED_ACCESS_TOKEN);
}

async function writeKeysConcurrently(round: string): Promise<void> {
  await Promise.all(
    ["w1", "w2", "w3", "w4", "w5", "w6"].map((worker) =>
      spawnWorker("write-keys", credentialsPath, `${round}-${worker}`),
    ),
  );
}

async function storedRefreshToken(mock: MockAuthorizationServer): Promise<string | undefined> {
  const entry = await createCredentialStore(credentialsPath).read(mock.mcpUrl);
  return entry?.tokens?.refresh_token;
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "vc-auth-concurrency-"));
  credentialsPath = join(directory, "credentials.json");
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(directory, { recursive: true, force: true });
});

describe("concurrent valcloud processes sharing credentials.json", () => {
  it("refreshes expired credentials once when two processes need them at the same time", async () => {
    server = await startMockAuthorizationServer({ refreshDelayMs: 300, reuseDelayMs: 0 });
    await seedExpiredCredentials(server);

    const runs = await Promise.all([
      spawnWorker("refresh-locked", credentialsPath, server.mcpUrl),
      spawnWorker("refresh-locked", credentialsPath, server.mcpUrl),
    ]);

    expect(runs).toStrictEqual([
      { exitCode: 0, stderr: "" },
      { exitCode: 0, stderr: "" },
    ]);
    expect(server.tokenRequests).toStrictEqual([
      { grantType: "refresh_token", refreshToken: "rt-seed" },
    ]);
    await expect(storedRefreshToken(server)).resolves.toBe("rt-1");
  });

  it("keeps the rotated tokens when an unlocked refresh loses the race with invalid_grant", async () => {
    server = await startMockAuthorizationServer({ refreshDelayMs: 800, reuseDelayMs: 1600 });
    await seedExpiredCredentials(server);

    const runs = await Promise.all([
      spawnWorker("refresh-unlocked", credentialsPath, server.mcpUrl),
      spawnWorker("refresh-unlocked", credentialsPath, server.mcpUrl),
    ]);

    expect(runs).toStrictEqual([
      { exitCode: 0, stderr: "" },
      { exitCode: 0, stderr: "" },
    ]);
    expect(server.tokenRequests).toStrictEqual([
      { grantType: "refresh_token", refreshToken: "rt-seed" },
      { grantType: "refresh_token", refreshToken: "rt-seed" },
      { grantType: "refresh_token", refreshToken: "rt-1" },
    ]);
    await expect(storedRefreshToken(server)).resolves.toBe("rt-2");
  });

  it("refreshes once when three processes get a 401 for a token that looks valid", async () => {
    server = await startMockAuthorizationServer({ refreshDelayMs: 300, reuseDelayMs: 0 });
    await seedCredentials(server, UNEXPIRED_ACCESS_TOKEN);

    const runs = await Promise.all([
      spawnWorker("unauthorized-locked", credentialsPath, server.mcpUrl),
      spawnWorker("unauthorized-locked", credentialsPath, server.mcpUrl),
      spawnWorker("unauthorized-locked", credentialsPath, server.mcpUrl),
    ]);

    expect(runs).toStrictEqual([
      { exitCode: 0, stderr: "" },
      { exitCode: 0, stderr: "" },
      { exitCode: 0, stderr: "" },
    ]);
    expect(server.tokenRequests).toStrictEqual([
      { grantType: "refresh_token", refreshToken: "rt-seed" },
    ]);
    await expect(storedRefreshToken(server)).resolves.toBe("rt-1");
  });

  it("gives up on a token endpoint that never answers and releases the lock", async () => {
    server = await startMockAuthorizationServer({ refreshDelayMs: 10_000, reuseDelayMs: 0 });
    await seedExpiredCredentials(server);
    const store = createCredentialStore(credentialsPath);
    const gateway = { url: server.mcpUrl };

    const run = await withSdkConsoleCaptured(() =>
      refreshStoredCredentials(gateway, store, {
        rejectedAccessToken: undefined,
        requestTimeoutMs: 300,
      }),
    );

    expect(run).toMatchObject({
      status: "rejected",
      reason: expect.any(RefreshFailedError) as unknown,
    });
    await expect(storedRefreshToken(server)).resolves.toBe("rt-seed");
    await expect(readdir(directory)).resolves.toStrictEqual(["credentials.json"]);
  });

  it("loses no key when many processes write different keys at once", async () => {
    await writeKeysConcurrently("a");
    await writeKeysConcurrently("b");
    await writeKeysConcurrently("c");

    const stored: unknown = JSON.parse(await readFile(credentialsPath, "utf8"));
    expect(Object.keys(stored as object)).toHaveLength(90);
    await expect(readdir(directory)).resolves.toStrictEqual(["credentials.json"]);
  });
});
