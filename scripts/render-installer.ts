import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import packageJson from "../package.json" with { type: "json" };
import nodeRuntime from "./node-runtime.json" with { type: "json" };
import { NODE_VERSION_PATTERN, PLATFORMS, SHA256_PATTERN } from "./node-releases.ts";
import type { NodeRuntime } from "./node-releases.ts";

export type InstallerValues = {
  version: string;
  bundleSha256: string;
  bundleUrl: string;
  nodeBase: string;
  nodeRuntime: NodeRuntime;
};

export const NODE_DIST_URL = "https://nodejs.org/dist";

const PACKAGE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
// Values land inside single quotes in the installer, so a quote or whitespace would break out of them.
const URL_PATTERN = /^(?:https|file):\/\/[^\s']+$/u;
const UNFILLED_PLACEHOLDER = /@[A-Z0-9_]+@/u;
const defaultTemplatePath = new URL("install.sh.in", import.meta.url);

export function releaseAssetUrl(version: string, asset: string): string {
  const repository = new URL(packageJson.homepage);
  repository.hash = "";
  return `${repository.href}/releases/download/v${version}/${asset}`;
}

function checked(name: string, value: string, pattern: RegExp): string {
  if (!pattern.test(value)) throw new Error(`invalid ${name} for the installer: ${value}`);
  return value;
}

function placeholders(values: InstallerValues): [string, string][] {
  const runtime = values.nodeRuntime;
  const hashes = PLATFORMS.map((platform): [string, string] => [
    `NODE_SHA256_${platform.toUpperCase().replaceAll("-", "_")}`,
    checked(`${platform} SHA-256`, runtime.sha256[platform], SHA256_PATTERN),
  ]);
  return [
    ["VALCLOUD_VERSION", checked("version", values.version, PACKAGE_VERSION_PATTERN)],
    ["VALCLOUD_SHA256", checked("bundle SHA-256", values.bundleSha256, SHA256_PATTERN)],
    ["VALCLOUD_URL", checked("bundle URL", values.bundleUrl, URL_PATTERN)],
    ["NODE_VERSION", checked("Node.js version", runtime.version, NODE_VERSION_PATTERN)],
    ["NODE_BASE", checked("Node.js download URL", values.nodeBase, URL_PATTERN)],
    ...hashes,
  ];
}

export function renderInstaller(template: string, values: InstallerValues): string {
  let rendered = template;
  for (const [name, value] of placeholders(values)) {
    const token = `@${name}@`;
    if (!rendered.includes(token)) throw new Error(`the installer template has no ${token}`);
    rendered = rendered.replaceAll(token, value);
  }
  const leftover = UNFILLED_PLACEHOLDER.exec(rendered);
  if (leftover !== null) throw new Error(`the installer template still has ${leftover[0]}`);
  return rendered;
}

export async function renderInstallerFile(options: {
  bundle: string;
  bundleUrl: string;
  nodeBase: string;
  version: string;
}): Promise<string> {
  const bundleSha256 = createHash("sha256")
    .update(await readFile(options.bundle))
    .digest("hex");
  const template = await readFile(defaultTemplatePath, "utf8");
  return renderInstaller(template, { ...options, bundleSha256, nodeRuntime });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      version: { type: "string" },
      bundle: { type: "string" },
      out: { type: "string" },
      "bundle-url": { type: "string" },
      "node-base": { type: "string", default: NODE_DIST_URL },
    },
    strict: true,
  });
  const { version, bundle, out } = values;
  if (version === undefined || bundle === undefined || out === undefined) {
    throw new Error(
      "usage: node scripts/render-installer.ts --version X --bundle FILE --out FILE [--bundle-url URL] [--node-base URL]",
    );
  }
  const rendered = await renderInstallerFile({
    version,
    bundle,
    bundleUrl: values["bundle-url"] ?? releaseAssetUrl(version, "valcloud.mjs"),
    nodeBase: values["node-base"],
  });
  await writeFile(out, rendered, { mode: 0o755 });
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
