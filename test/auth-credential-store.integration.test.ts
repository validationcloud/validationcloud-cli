import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCredentialStore } from "#auth/credential-store";
import { CredentialsFileError } from "#auth/credentials-file-error";

let directory: string;
let credentialsPath: string;

function exitedProcessId(): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", () => {
      resolve(child.pid ?? -1);
    });
  });
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "vc-auth-store-"));
  credentialsPath = join(directory, "credentials.json");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("credential store on disk", () => {
  it("reports invalid JSON without quoting the file", async () => {
    await writeFile(
      credentialsPath,
      '{"https://mcp.example.test/mcp": {"tokens": {"access_token": "eyJsecret-fragment',
    );
    const error = await caught(
      createCredentialStore(credentialsPath).read("https://mcp.example.test/mcp"),
    );

    expect(error).toBeInstanceOf(CredentialsFileError);
    expect((error as Error).message).toBe(
      `credentials file ${directory}/credentials.json is unreadable or corrupt; run 'vcloud auth logout' or delete the file, then log in again`,
    );
    expect((error as Error).message).not.toContain("secret-fragment");
    expect((error as Error).cause).toBeUndefined();
  });

  it("reports a schema mismatch with the same fixed error", async () => {
    await writeFile(
      credentialsPath,
      '{"https://mcp.example.test/mcp": {"tokens": {"access_token": 42}}}',
    );

    await expect(
      createCredentialStore(credentialsPath).read("https://mcp.example.test/mcp"),
    ).rejects.toThrow(CredentialsFileError);
  });

  it("discards an unreadable file and says so", async () => {
    await writeFile(credentialsPath, "not json");
    const store = createCredentialStore(credentialsPath);

    await expect(store.discardUnreadable()).resolves.toBe(true);
    await expect(readdir(directory)).resolves.toStrictEqual([]);
    await expect(store.read("https://mcp.example.test/mcp")).resolves.toBeUndefined();
  });

  it("keeps a readable file when asked to discard an unreadable one", async () => {
    const store = createCredentialStore(credentialsPath);
    await store.update("https://mcp.example.test/mcp", () => ({ tokensSavedAtMs: 1 }));

    await expect(store.discardUnreadable()).resolves.toBe(false);
    await expect(store.read("https://mcp.example.test/mcp")).resolves.toStrictEqual({
      tokensSavedAtMs: 1,
    });
  });

  it("reports nothing to discard when there is no file", async () => {
    await expect(createCredentialStore(credentialsPath).discardUnreadable()).resolves.toBe(false);
  });

  it("writes the file with mode 0600", async () => {
    await createCredentialStore(credentialsPath).update("https://mcp.example.test/mcp", () => ({
      tokensSavedAtMs: 1,
    }));
    const { mode } = await stat(credentialsPath);

    expect(mode.toString(8)).toBe("100600");
  });

  it("recovers a lock left behind by a process that exited", async () => {
    const pid = await exitedProcessId();
    await writeFile(
      `${credentialsPath}.lock`,
      JSON.stringify({ pid, acquiredAtMs: Date.now(), nonce: "dead-owner" }),
    );
    await createCredentialStore(credentialsPath).update("https://mcp.example.test/mcp", () => ({
      tokensSavedAtMs: 2,
    }));

    await expect(readdir(directory)).resolves.toStrictEqual(["credentials.json"]);
  });

  it("recovers a lock whose live owner stopped refreshing it 60 s ago", async () => {
    const lockPath = `${credentialsPath}.lock`;
    await writeFile(
      lockPath,
      JSON.stringify({ pid: process.ppid, acquiredAtMs: 0, nonce: "frozen-owner" }),
    );
    const sixtySecondsAgo = new Date(Date.now() - 60_000);
    await utimes(lockPath, sixtySecondsAgo, sixtySecondsAgo);
    await createCredentialStore(credentialsPath).update("https://mcp.example.test/mcp", () => ({
      tokensSavedAtMs: 3,
    }));

    await expect(readdir(directory)).resolves.toStrictEqual(["credentials.json"]);
  });

  it("serializes overlapping updates inside one process", async () => {
    const store = createCredentialStore(credentialsPath);
    await Promise.all([
      store.update("https://mcp.validationcloud.io/mcp", (entry) => ({
        ...entry,
        tokensSavedAtMs: 1,
      })),
      store.update("https://mcp.example.test/mcp", (entry) => ({ ...entry, tokensSavedAtMs: 2 })),
      store.update("dev", (entry) => ({ ...entry, tokensSavedAtMs: 3 })),
    ]);

    await expect(store.read("https://mcp.validationcloud.io/mcp")).resolves.toStrictEqual({
      tokensSavedAtMs: 1,
    });
    await expect(store.read("https://mcp.example.test/mcp")).resolves.toStrictEqual({
      tokensSavedAtMs: 2,
    });
    await expect(store.read("dev")).resolves.toStrictEqual({ tokensSavedAtMs: 3 });
  });

  it("lets code holding the lock update the store without deadlocking", async () => {
    const store = createCredentialStore(credentialsPath);
    await store.withLock(async () => {
      await store.update("https://mcp.example.test/mcp", () => ({ tokensSavedAtMs: 4 }));
    });

    await expect(store.read("https://mcp.example.test/mcp")).resolves.toStrictEqual({
      tokensSavedAtMs: 4,
    });
  });
});
