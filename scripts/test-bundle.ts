import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nodeRuntime from "./node-runtime.json" with { type: "json" };

const root = join(import.meta.dirname, "..");

// Runs the CLI integration suite against the release bundle, under the Node.js version the installer ships.
async function main(): Promise<void> {
  if (process.versions.node !== nodeRuntime.version) {
    throw new Error(
      `run this under Node.js ${nodeRuntime.version}, the version pinned in scripts/node-runtime.json (this is ${process.versions.node}); the installer ships that runtime, so any other one proves nothing about it`,
    );
  }
  execFileSync(process.execPath, [join(root, "scripts", "build-release.ts")], { stdio: "inherit" });

  // The bundle is copied out of the repository so that it cannot resolve anything from node_modules.
  const directory = await mkdtemp(join(tmpdir(), "valcloud-bundle-test-"));
  try {
    const entry = join(directory, "valcloud.mjs");
    await copyFile(join(root, "release", "valcloud.mjs"), entry);
    execFileSync(
      process.execPath,
      [join(root, "node_modules", "vitest", "vitest.mjs"), "run", "test/cli.integration.test.ts"],
      { cwd: root, stdio: "inherit", env: { ...process.env, VALCLOUD_ENTRY: entry } },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
