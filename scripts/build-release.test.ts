import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertReleaseAssets } from "./build-release.ts";

describe("assertReleaseAssets", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "valcloud-assets-"));
    await writeFile(join(directory, "valcloud.mjs"), "bundle");
    await writeFile(join(directory, "install.sh"), "installer");
    await writeFile(join(directory, "SHA256SUMS"), "sums");
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("accepts a complete set", async () => {
    await expect(assertReleaseAssets(directory)).resolves.toBeUndefined();
  });

  it("names a missing asset", async () => {
    await rm(join(directory, "install.sh"));

    await expect(assertReleaseAssets(directory)).rejects.toThrow(
      `release asset ${join(directory, "install.sh")} does not exist`,
    );
  });

  it("rejects an empty asset", async () => {
    await writeFile(join(directory, "SHA256SUMS"), "");

    await expect(assertReleaseAssets(directory)).rejects.toThrow(
      `release asset ${join(directory, "SHA256SUMS")} is empty`,
    );
  });
});
