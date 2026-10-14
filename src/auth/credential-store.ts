import { chmod, mkdir, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import * as z from "zod";
import { CredentialsFileError } from "./credentials-file-error.ts";
import { withCredentialsLock } from "./credentials-lock.ts";
import { writeFileAtomic } from "#shared/write-file-atomic";

const StoredTokens = z.looseObject({
  access_token: z.string(),
  token_type: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  id_token: z.string().optional(),
  scope: z.string().optional(),
  issuer: z.string().optional(),
});

const StoredClient = z.looseObject({
  client_id: z.string(),
  issuer: z.string().optional(),
});

const CredentialEntry = z.object({
  client: StoredClient.optional(),
  tokens: StoredTokens.optional(),
  tokensSavedAtMs: z.number().optional(),
});

const CredentialFile = z.record(z.string(), CredentialEntry);

export type CredentialEntry = z.infer<typeof CredentialEntry>;

export type CredentialStore = {
  read: (key: string) => Promise<CredentialEntry | undefined>;
  update: (key: string, change: (entry: CredentialEntry) => CredentialEntry) => Promise<void>;
  remove: (key: string) => Promise<void>;
  discardUnreadable: () => Promise<boolean>;
  withLock: <T>(fn: () => Promise<T>) => Promise<T>;
};

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function parseCredentialFile(text: string): z.infer<typeof CredentialFile> | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = CredentialFile.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}

export function createCredentialStore(filePath: string): CredentialStore {
  async function readAll(): Promise<z.infer<typeof CredentialFile>> {
    let text: string;
    try {
      text = await readFile(filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return {};
      throw error;
    }
    const all = parseCredentialFile(text);
    // Parser messages quote file content, which can include a token fragment.
    if (all === undefined) throw new CredentialsFileError(filePath);
    return all;
  }

  async function writeAll(all: z.infer<typeof CredentialFile>): Promise<void> {
    const directory = dirname(filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    await writeFileAtomic(filePath, `${JSON.stringify(all, undefined, 2)}\n`, 0o600);
  }

  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    return withCredentialsLock(filePath, fn);
  }

  return {
    async read(key) {
      const all = await readAll();
      return all[key];
    },
    async update(key, change) {
      await withLock(async () => {
        const all = await readAll();
        await writeAll({ ...all, [key]: change(all[key] ?? {}) });
      });
    },
    async remove(key) {
      await withLock(async () => {
        const { [key]: removed, ...rest } = await readAll();
        if (removed !== undefined) await writeAll(rest);
      });
    },
    async discardUnreadable() {
      return withLock(async () => {
        try {
          await readAll();
          return false;
        } catch (error) {
          if (!(error instanceof CredentialsFileError)) throw error;
        }
        await rm(filePath, { force: true });
        return true;
      });
    },
    withLock,
  };
}
