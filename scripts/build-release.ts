import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import packageJson from "../package.json" with { type: "json" };
import bundledPackages from "./bundled-packages.json" with { type: "json" };
import vendoredLicenses from "./vendored-licenses.json" with { type: "json" };
import { NODE_DIST_URL, releaseAssetUrl, renderInstallerFile } from "./render-installer.ts";
import { asBlockComment, collectNotices, formatNotices } from "./third-party-notices.ts";

const root = join(import.meta.dirname, "..");
const releaseDirectory = join(root, "release");

export const RELEASE_ASSETS = ["valcloud.mjs", "install.sh", "SHA256SUMS"] as const;

const REQUIRE_SHIM =
  "import{createRequire}from'node:module';const require=createRequire(import.meta.url);";

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function bundleCli(): Promise<string> {
  const result = await build({
    entryPoints: [join(root, "dist", "cli.js")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22.12",
    // Inline notices of vendored code (content-type inside the MCP client) are kept; the dependencies' LICENSE files are appended below.
    legalComments: "eof",
    banner: { js: REQUIRE_SHIM },
    metafile: true,
    write: false,
    logLevel: "warning",
  });
  const [output] = result.outputFiles;
  if (output === undefined) throw new Error("esbuild produced no output");
  const projectLicense = await readFile(join(root, "LICENSE"), "utf8");
  const dependencies = await collectNotices(
    Object.keys(result.metafile.inputs),
    root,
    vendoredLicenses,
    bundledPackages,
  );
  const notices = formatNotices([
    {
      name: packageJson.name,
      version: packageJson.version,
      license: "MIT",
      texts: [projectLicense],
    },
    ...dependencies,
  ]);
  return `${output.text}\n${asBlockComment(notices)}`;
}

// Runs from an empty directory so a bare import left in the bundle fails instead of resolving through this repository's node_modules.
async function smokeTestBundle(bundle: string, version: string): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "valcloud-bundle-"));
  try {
    const copy = join(directory, "valcloud.mjs");
    await copyFile(bundle, copy);
    const reported = execFileSync(process.execPath, [copy, "--version"], {
      cwd: directory,
      encoding: "utf8",
    }).trim();
    if (reported !== version) {
      throw new Error(`the bundle reports version ${reported}, expected ${version}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// @semantic-release/github publishes a release even when an asset is missing, so a missing file must fail here.
export async function assertReleaseAssets(directory: string): Promise<void> {
  for (const asset of RELEASE_ASSETS) {
    const path = join(directory, asset);
    const { size } = await stat(path).catch((error: unknown) => {
      throw new Error(`release asset ${path} does not exist`, { cause: error });
    });
    if (size === 0) throw new Error(`release asset ${path} is empty`);
  }
}

async function main(): Promise<void> {
  const version = process.argv[2] ?? packageJson.version;
  if (version !== packageJson.version) {
    throw new Error(
      `package.json says ${packageJson.version} but the release is ${version}; run this after @semantic-release/npm has set the version`,
    );
  }
  execFileSync("pnpm", ["run", "rebuild"], { cwd: root, stdio: "inherit" });
  await rm(releaseDirectory, { recursive: true, force: true });
  await mkdir(releaseDirectory);

  const bundlePath = join(releaseDirectory, "valcloud.mjs");
  await writeFile(bundlePath, await bundleCli());
  await smokeTestBundle(bundlePath, version);

  const installer = await renderInstallerFile({
    version,
    bundle: bundlePath,
    bundleUrl: releaseAssetUrl(version, "valcloud.mjs"),
    nodeBase: NODE_DIST_URL,
  });
  await writeFile(join(releaseDirectory, "install.sh"), installer, { mode: 0o755 });

  const bundle = await readFile(bundlePath);
  const sums = [`${sha256(bundle)}  valcloud.mjs`, `${sha256(installer)}  install.sh`];
  await writeFile(join(releaseDirectory, "SHA256SUMS"), `${sums.join("\n")}\n`);
  await assertReleaseAssets(releaseDirectory);
  console.error(`Built ${RELEASE_ASSETS.join(", ")} for ${version} in ${releaseDirectory}`);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
