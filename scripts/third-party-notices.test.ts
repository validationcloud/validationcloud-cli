import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  asBlockComment,
  collectNotices,
  packageDirectories,
  readNoticeEntry,
} from "./third-party-notices.ts";

describe("packageDirectories", () => {
  it("names each bundled package once, scoped or not, and skips project files", () => {
    const inputs = [
      "node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/util.js",
      "node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/core.js",
      "node_modules/.pnpm/@scope+pkg@1.0.0/node_modules/@scope/pkg/dist/a.mjs",
      "dist/cli.js",
      "package.json",
    ];

    expect(packageDirectories(inputs, "/repo")).toStrictEqual([
      "/repo/node_modules/.pnpm/@scope+pkg@1.0.0/node_modules/@scope/pkg",
      "/repo/node_modules/.pnpm/zod@4.6.5/node_modules/zod",
    ]);
  });
});

describe("asBlockComment", () => {
  it("keeps a license text from ending the comment early", () => {
    expect(asBlockComment("a */ b\n")).toBe("/*!\na * / b\n*/\n");
  });
});

describe("readNoticeEntry", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "valcloud-notices-"));
    await mkdir(join(directory, "pkg"));
    await writeFile(
      join(directory, "pkg", "package.json"),
      JSON.stringify({ name: "pkg", version: "1.0.0", license: "MIT" }),
    );
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("reads the license and notice files of a package", async () => {
    await writeFile(join(directory, "pkg", "LICENSE"), "MIT text");
    await writeFile(join(directory, "pkg", "NOTICE.md"), "notice text");

    await expect(readNoticeEntry(join(directory, "pkg"))).resolves.toStrictEqual({
      name: "pkg",
      version: "1.0.0",
      license: "MIT",
      texts: ["MIT text", "notice text"],
    });
  });

  it("fails for a bundled package without a license file", async () => {
    await expect(readNoticeEntry(join(directory, "pkg"))).rejects.toThrow(
      "pkg@1.0.0 is bundled but ships no LICENSE file",
    );
  });
});

describe("collectNotices", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "valcloud-collect-"));
    const pkg = join(root, "node_modules", ".pnpm", "x@1.0.0", "node_modules", "x");
    await mkdir(join(pkg, "dist"), { recursive: true });
    await writeFile(
      join(pkg, "package.json"),
      JSON.stringify({ name: "x", version: "1.0.0", license: "MIT" }),
    );
    await writeFile(join(pkg, "LICENSE"), "MIT text");
    await writeFile(join(pkg, "dist", "a.js"), "");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const inputs = ["node_modules/.pnpm/x@1.0.0/node_modules/x/dist/a.js"];
  const none = { packages: [], files: [] };

  it("fails for a bundled file that has no sourcemap and is not on the reviewed list", async () => {
    await expect(collectNotices(inputs, root, {}, none)).rejects.toThrow(
      "x/dist/a.js have no sourcemap, so code inlined in them cannot be listed",
    );
  });

  it("lists a file of a reviewed package without a sourcemap", async () => {
    await expect(
      collectNotices(inputs, root, {}, { packages: ["x"], files: [] }),
    ).resolves.toStrictEqual([
      { name: "x", version: "1.0.0", license: "MIT", texts: ["MIT text"] },
    ]);
  });

  it("fails for a map-less file in a package whose other files have sourcemaps", async () => {
    const pkg = join(root, "node_modules", ".pnpm", "x@1.0.0", "node_modules", "x", "dist");
    await writeFile(join(pkg, "b.js"), "");
    await writeFile(
      join(pkg, "b.js.map"),
      JSON.stringify({ version: 3, sources: ["../src/b.ts"], mappings: "" }),
    );
    const both = [...inputs, "node_modules/.pnpm/x@1.0.0/node_modules/x/dist/b.js"];

    await expect(collectNotices(both, root, {}, none)).rejects.toThrow(
      /x\/dist\/a\.js have no sourcemap/u,
    );
    await expect(
      collectNotices(both, root, {}, { packages: [], files: ["x/dist/a.js"] }),
    ).resolves.toHaveLength(1);
  });
});
