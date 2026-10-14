import { auth } from "@modelcontextprotocol/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthRequiredError } from "#auth/auth-required-error";
import { withSdkConsoleCaptured } from "#auth/capture-sdk-console";
import { createCredentialStore } from "#auth/credential-store";
import type { CredentialEntry, CredentialStore } from "#auth/credential-store";
import { RefreshFailedError } from "#auth/refresh-failed-error";
import { VcOAuthProvider } from "#auth/vc-oauth-provider";
import { startMockAuthorizationServer } from "./auth-mock-authorization-server.ts";
import type { MockAuthorizationServer } from "./auth-mock-authorization-server.ts";

// Payload {"exp":1}: expired long ago.
const EXPIRED_ACCESS_TOKEN = "h.eyJleHAiOjF9.s";

let directory: string;
let store: CredentialStore;
let server: MockAuthorizationServer;
let key: string;

function storedProvider(): VcOAuthProvider {
  return new VcOAuthProvider({ store, key, onRedirect: undefined, ignoreStoredTokens: false });
}

async function seed(client: CredentialEntry["client"]): Promise<void> {
  await store.update(key, () => ({
    client,
    tokens: {
      access_token: EXPIRED_ACCESS_TOKEN,
      token_type: "Bearer",
      refresh_token: "rt-seed",
      issuer: server.issuer,
    },
    tokensSavedAtMs: 0,
  }));
}

function runAuth(provider: VcOAuthProvider): ReturnType<typeof withSdkConsoleCaptured> {
  return withSdkConsoleCaptured(() => auth(provider, { serverUrl: new URL(server.mcpUrl) }));
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "vc-auth-provider-"));
  store = createCredentialStore(join(directory, "credentials.json"));
  server = await startMockAuthorizationServer({ refreshDelayMs: 0, reuseDelayMs: 0 });
  key = server.mcpUrl;
});

afterEach(async () => {
  await server.close();
  await rm(directory, { recursive: true, force: true });
});

describe("the OAuth provider outside login", () => {
  it("refreshes expired tokens with the stored client", async () => {
    server.acceptRefreshToken("rt-seed");
    await seed({ client_id: "cli-client", issuer: server.issuer });
    const run = await runAuth(storedProvider());

    expect(run).toStrictEqual({ status: "fulfilled", value: "AUTHORIZED", suppressedCount: 0 });
    expect(server.registrations).toStrictEqual([]);
    const entry = await store.read(key);
    expect(entry?.tokens?.refresh_token).toBe("rt-1");
    expect(entry?.client).toStrictEqual({ client_id: "cli-client", issuer: server.issuer });
  });

  it("stamps the issuer onto a stored client without registering a new one", async () => {
    server.acceptRefreshToken("rt-seed");
    await seed({ client_id: "cli-client" });
    const run = await runAuth(storedProvider());

    expect(run).toStrictEqual({ status: "fulfilled", value: "AUTHORIZED", suppressedCount: 1 });
    expect(server.registrations).toStrictEqual([]);
    const entry = await store.read(key);
    expect(entry?.client).toStrictEqual({ client_id: "cli-client", issuer: server.issuer });
    expect(entry?.tokens?.refresh_token).toBe("rt-1");
  });

  it("requires login instead of registering when no client is stored", async () => {
    server.acceptRefreshToken("rt-seed");
    await seed(undefined);
    const run = await runAuth(storedProvider());

    expect(run).toStrictEqual({
      status: "rejected",
      reason: expect.any(AuthRequiredError) as unknown,
      suppressedCount: 0,
    });
    expect(server.registrations).toStrictEqual([]);
    expect(server.tokenRequests).toStrictEqual([]);
  });

  it("requires login instead of registering when the stored client belongs to another issuer", async () => {
    server.acceptRefreshToken("rt-seed");
    await seed({ client_id: "cli-client", issuer: "https://other-issuer.example.com" });
    const run = await runAuth(storedProvider());

    expect(run).toStrictEqual({
      status: "rejected",
      reason: expect.any(AuthRequiredError) as unknown,
      suppressedCount: 0,
    });
    expect(server.registrations).toStrictEqual([]);
    expect(server.tokenRequests).toStrictEqual([]);
  });

  it("refuses to save a different client", async () => {
    await seed({ client_id: "cli-client", issuer: server.issuer });

    await expect(
      storedProvider().saveClientInformation({ client_id: "registered-1" }),
    ).rejects.toThrow(AuthRequiredError);
    const entry = await store.read(key);
    expect(entry?.client).toStrictEqual({ client_id: "cli-client", issuer: server.issuer });
  });

  it("keeps the stored credentials when the token endpoint fails with 500", async () => {
    server.acceptRefreshToken("rt-seed");
    server.failTokenRequests(500);
    await seed({ client_id: "cli-client", issuer: server.issuer });
    const run = await runAuth(storedProvider());

    expect(run).toStrictEqual({
      status: "rejected",
      reason: expect.any(RefreshFailedError) as unknown,
      suppressedCount: 1,
    });
    const entry = await store.read(key);
    expect(entry?.tokens?.refresh_token).toBe("rt-seed");
  });

  it("deletes tokens the authorization server refuses with invalid_grant and requires login", async () => {
    await seed({ client_id: "cli-client", issuer: server.issuer });
    const provider = storedProvider();
    const run = await runAuth(provider);

    expect(run).toStrictEqual({
      status: "rejected",
      reason: expect.any(AuthRequiredError) as unknown,
      suppressedCount: 1,
    });
    await expect(store.read(key)).resolves.toStrictEqual({
      client: { client_id: "cli-client", issuer: server.issuer },
    });
  });

  it("keeps tokens another process rotated in after this one read them", async () => {
    await seed({ client_id: "cli-client", issuer: server.issuer });
    const provider = storedProvider();
    await provider.tokens();
    await store.update(key, (entry) => ({
      ...entry,
      tokens: { access_token: "newer", token_type: "Bearer", refresh_token: "rt-newer" },
    }));
    await provider.invalidateCredentials("tokens");

    const entry = await store.read(key);
    expect(entry?.tokens?.refresh_token).toBe("rt-newer");
  });
});
