import { auth } from "@modelcontextprotocol/client";
import { withSdkConsoleCaptured } from "#auth/capture-sdk-console";
import { createCredentialStore } from "#auth/credential-store";
import { createStoredTokenProvider } from "#auth/create-stored-token-provider";
import { refreshStoredCredentials } from "#auth/refresh-stored-credentials";
import { VcOAuthProvider } from "#auth/vc-oauth-provider";

export const refreshWorkerPath = import.meta.filename;

export type WorkerMode =
  | "refresh-locked"
  | "refresh-unlocked"
  | "unauthorized-locked"
  | "write-keys";

async function run(mode: string, credentialsPath: string, argument: string): Promise<void> {
  const store = createCredentialStore(credentialsPath);
  if (mode === "write-keys") {
    for (let index = 0; index < 5; index += 1) {
      await store.update(`${argument}-${index}`, (entry) => ({ ...entry, tokensSavedAtMs: index }));
    }
    return;
  }
  const gateway = { url: argument };
  if (mode === "refresh-locked") {
    await refreshStoredCredentials(gateway, store, {
      rejectedAccessToken: undefined,
      requestTimeoutMs: undefined,
    });
    return;
  }
  if (mode === "unauthorized-locked") {
    const provider = createStoredTokenProvider(gateway, store);
    await provider.token();
    await provider.onUnauthorized?.({
      response: new Response(null, { status: 401 }),
      serverUrl: new URL(argument),
      fetchFn: fetch,
    });
    return;
  }
  const provider = new VcOAuthProvider({
    store,
    key: gateway.url,
    onRedirect: undefined,
    ignoreStoredTokens: false,
  });
  await auth(provider, { serverUrl: new URL(argument) });
}

// import.meta.main exists only from Node 24.2, so compare the entry path instead.
if (process.argv[1] === refreshWorkerPath) {
  const [mode = "", credentialsPath = "", argument = ""] = process.argv.slice(2);
  const outcome = await withSdkConsoleCaptured(() => run(mode, credentialsPath, argument));
  if (outcome.status === "rejected") {
    const reason = outcome.reason instanceof Error ? outcome.reason.name : "unknown";
    process.stderr.write(`worker failed: ${reason}\n`);
    process.exitCode = 1;
  }
}
