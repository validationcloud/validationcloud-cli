import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeCommits } from "@semantic-release/commit-analyzer";
import { describe, expect, it } from "vitest";
import config from "../release.config.js";
import { RELEASE_ASSETS } from "./build-release.ts";

type PluginSpec = string | [string, Record<string, unknown>];
const plugins = config.plugins as PluginSpec[];

function optionsOf(name: string): Record<string, unknown> {
  const spec = plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === name);
  if (!Array.isArray(spec)) throw new Error(`${name} is not configured`);
  return spec[1];
}

// The analyzer is listed by name only, so it runs with its default rules.
function commitAnalyzerOptions(): Record<string, unknown> {
  if (!plugins.includes("@semantic-release/commit-analyzer")) {
    throw new Error("the commit analyzer is not configured with its default options");
  }
  return {};
}

function pluginNames(): string[] {
  return plugins.map((plugin) => (typeof plugin === "string" ? plugin : plugin[0]));
}

async function releaseFor(message: string): Promise<string | null> {
  return analyzeCommits(commitAnalyzerOptions(), {
    cwd: process.cwd(),
    commits: [{ hash: "abc", message }],
    logger: { log: () => undefined },
  });
}

describe("release config", () => {
  it("builds the bundle after npm has written the version into package.json", () => {
    expect(pluginNames()).toStrictEqual([
      "@semantic-release/commit-analyzer",
      "@semantic-release/release-notes-generator",
      "@semantic-release/npm",
      "@semantic-release/exec",
      "@semantic-release/github",
    ]);
  });

  it("uploads exactly the files build-release.ts checks for", () => {
    expect(optionsOf("@semantic-release/github").assets).toStrictEqual(
      RELEASE_ASSETS.map((asset) => ({ path: `release/${asset}` })),
    );
  });

  it.each([
    ["fix(runtime): bundle Node.js 24.23.0", "patch"],
    ["fix(deps): bump zod", "patch"],
    ["feat(runtime): add a platform", "minor"],
    ["feat: add a command", "minor"],
    ["chore(deps): bump zod", null],
    ["chore(runtime): bundle Node.js 24.23.0", null],
    ["fix(runtime): drop Node.js 22\n\nBREAKING CHANGE: Node.js 22 is no longer bundled", "major"],
  ])("%s releases %s", async (message, release) => {
    await expect(releaseFor(message)).resolves.toBe(release);
  });

  describe("the success command", () => {
    // The exec plugin fills this placeholder in before it runs the command.
    const placeholder = ["$", "{nextRelease.version}"].join("");
    const command = String(optionsOf("@semantic-release/exec").successCmd).replace(
      placeholder,
      "1.2.3",
    );

    it("appends the version to GITHUB_OUTPUT", async () => {
      const directory = await mkdtemp(join(tmpdir(), "valcloud-release-"));
      try {
        const output = join(directory, "output");
        spawnSync("sh", ["-c", command], { env: { GITHUB_OUTPUT: output } });

        await expect(readFile(output, "utf8")).resolves.toBe("version=1.2.3\n");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });

    it("fails with a message when GITHUB_OUTPUT is unset", () => {
      const result = spawnSync("sh", ["-c", command], { env: {}, encoding: "utf8" });

      expect({ status: result.status, stderr: result.stderr.trim() }).toStrictEqual({
        status: 1,
        stderr:
          "GITHUB_OUTPUT is not set, so the smoke-install job cannot learn the released version",
      });
    });
  });
});
