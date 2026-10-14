import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "#shared/write-file-atomic";
import { CatalogCache } from "#core/catalog-cache";
import { nameCatalogFile } from "#core/name-catalog-file";

export type CatalogStore = {
  read: (gatewayUrl: string) => Promise<CatalogCache | undefined>;
  write: (gatewayUrl: string, cache: CatalogCache) => Promise<void>;
  remove: (gatewayUrl: string) => Promise<void>;
};

export function createCatalogStore(directory: string): CatalogStore {
  return {
    async read(gatewayUrl) {
      try {
        const text = await readFile(join(directory, nameCatalogFile(gatewayUrl)), "utf8");
        const parsed = CatalogCache.safeParse(JSON.parse(text));
        return parsed.success ? parsed.data : undefined;
      } catch {
        // The cache is disposable: a missing or unreadable file is a miss, not a failure.
        return undefined;
      }
    },
    async write(gatewayUrl, cache) {
      await mkdir(directory, { recursive: true });
      await writeFileAtomic(
        join(directory, nameCatalogFile(gatewayUrl)),
        `${JSON.stringify(cache)}\n`,
        0o600,
      );
    },
    async remove(gatewayUrl) {
      await rm(join(directory, nameCatalogFile(gatewayUrl)), { force: true });
    },
  };
}
