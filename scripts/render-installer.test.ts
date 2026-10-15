import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import nodeRuntime from "./node-runtime.json" with { type: "json" };
import { releaseAssetUrl, renderInstaller } from "./render-installer.ts";
import type { InstallerValues } from "./render-installer.ts";

const values: InstallerValues = {
  version: "1.2.3",
  bundleSha256: "a".repeat(64),
  bundleUrl: "https://example.com/releases/download/v1.2.3/valcloud.mjs",
  nodeBase: "https://nodejs.org/dist",
  nodeRuntime,
};

const template = await readFile(new URL("install.sh.in", import.meta.url), "utf8");

describe("renderInstaller", () => {
  it("fills every placeholder of the real template", () => {
    const rendered = renderInstaller(template, values);

    expect(rendered).toContain(`VALCLOUD_VERSION='1.2.3'`);
    expect(rendered).toContain(`VALCLOUD_SHA256='${"a".repeat(64)}'`);
    expect(rendered).toContain(
      `VALCLOUD_URL='https://example.com/releases/download/v1.2.3/valcloud.mjs'`,
    );
    expect(rendered).not.toMatch(/@[A-Z0-9_]+@/u);
  });

  it("pins the Node.js runtime from node-runtime.json", () => {
    const rendered = renderInstaller(template, values);

    expect(rendered).toContain(`NODE_VERSION='24.22.0'`);
    expect(rendered).toContain(
      `NODE_SHA256_LINUX_X64_MUSL='a95a0faf28d6f7c493036f0559d6d32b7b8c79aa06e415b12782f96946844484'`,
    );
  });

  it("refuses a URL that could end the single quotes around it", () => {
    const hostile = { ...values, bundleUrl: "https://example.com/a'; rm -rf ~; echo '" };

    expect(() => renderInstaller(template, hostile)).toThrow(
      "invalid bundle URL for the installer",
    );
  });

  it("refuses a bundle hash that is not 64 hex digits", () => {
    expect(() => renderInstaller(template, { ...values, bundleSha256: "abc" })).toThrow(
      "invalid bundle SHA-256 for the installer: abc",
    );
  });

  it("fails when the template lacks a placeholder", () => {
    expect(() => renderInstaller("echo hello\n", values)).toThrow(
      "the installer template has no @VALCLOUD_VERSION@",
    );
  });

  it("fails when the template has a placeholder nobody fills", () => {
    expect(() => renderInstaller(`${template}\n# @NEW_PLACEHOLDER@\n`, values)).toThrow(
      "the installer template still has @NEW_PLACEHOLDER@",
    );
  });
});

describe("releaseAssetUrl", () => {
  it("points at the release's own asset", () => {
    expect(releaseAssetUrl("1.2.3", "valcloud.mjs")).toBe(
      "https://github.com/validationcloud/validationcloud-cli/releases/download/v1.2.3/valcloud.mjs",
    );
  });
});

describe("running as a script", () => {
  // Node 22.12, the engines floor, cannot run .ts files; release scripts run on the pinned Node.
  it.skipIf(process.features.typescript === false)(
    "still runs main when started through a symlink",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "valcloud-symlink-"));
      try {
        const link = join(directory, "render-link.ts");
        await symlink(join(import.meta.dirname, "render-installer.ts"), link);
        const result = spawnSync(process.execPath, [link, "--no-such-option"], {
          cwd: directory,
          encoding: "utf8",
        });

        expect({ status: result.status, stderr: result.stderr.trim() }).toStrictEqual({
          status: 1,
          stderr: expect.stringContaining("--no-such-option") as string,
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
