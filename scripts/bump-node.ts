import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import releaseKeys from "./node-release-keys.json" with { type: "json" };
import nodeRuntime from "./node-runtime.json" with { type: "json" };
import {
  formatRuntime,
  latestInMajor,
  NODE_VERSION_PATTERN,
  parseShasums,
  trustedSigner,
} from "./node-releases.ts";

const runtimePath = join(import.meta.dirname, "node-runtime.json");
const RELEASE_KEYS_REPOSITORY = "https://github.com/nodejs/release-keys";

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} returned ${response.status}`);
  return response.text();
}

function requireTool(tool: string): void {
  try {
    execFileSync(tool, ["--version"], { stdio: "ignore" });
  } catch (error) {
    throw new Error(`${tool} is required to verify the Node.js release signature`, {
      cause: error,
    });
  }
}

// Only the keys committed in scripts/node-release-keys.json are imported, so retired keys in nodejs/release-keys are never trusted; their key files may carry revocation certificates, which gpg applies.
async function importReleaseKeys(
  scratch: string,
): Promise<{ gnupgHome: string; trusted: string[] }> {
  const keys = join(scratch, "release-keys");
  execFileSync("git", ["clone", "--quiet", "--depth", "1", RELEASE_KEYS_REPOSITORY, keys]);
  const trusted = releaseKeys.keys.map((key) => key.fingerprint);
  const gnupgHome = join(scratch, "gnupg");
  await mkdir(gnupgHome, { mode: 0o700 });
  // --no-autostart: a long GNUPGHOME path makes gpg try to spawn an agent socket it cannot create.
  execFileSync(
    "gpg",
    [
      "--homedir",
      gnupgHome,
      "--batch",
      "--no-autostart",
      "--import",
      ...trusted.map((fingerprint) => join(keys, "keys", `${fingerprint}.asc`)),
    ],
    { stdio: "ignore" },
  );
  return { gnupgHome, trusted };
}

// The pinned hashes are the installer's trust anchor, so they come only from a SHASUMS256.txt.asc signed by one of the active releasers' keys committed in scripts/node-release-keys.json.
async function verifiedShasums(version: string, scratch: string): Promise<string> {
  const { gnupgHome, trusted } = await importReleaseKeys(scratch);
  const signed = join(scratch, "SHASUMS256.txt.asc");
  const cleartext = join(scratch, "SHASUMS256.txt");
  const status = join(scratch, "gpg-status");
  await writeFile(
    signed,
    await fetchText(`https://nodejs.org/dist/v${version}/SHASUMS256.txt.asc`),
  );
  let gpgFailure: unknown;
  try {
    execFileSync(
      "gpg",
      [
        "--homedir",
        gnupgHome,
        "--batch",
        "--no-autostart",
        "--status-file",
        status,
        "--output",
        cleartext,
        "--decrypt",
        signed,
      ],
      { stdio: "ignore" },
    );
  } catch (error) {
    gpgFailure = error;
  }
  const statusText = await readFile(status, "utf8").catch(() => "");
  // gpg exits non-zero for a bad signature; the status lines say why.
  const signer = trustedSigner(statusText, trusted);
  if (gpgFailure !== undefined) {
    throw new Error(`gpg could not verify SHASUMS256.txt.asc for v${version}`, {
      cause: gpgFailure,
    });
  }
  console.error(`SHASUMS256.txt.asc for v${version} is signed by ${signer}`);
  return readFile(cleartext, "utf8");
}

async function targetVersion(requested: string | undefined): Promise<string> {
  if (requested !== undefined) {
    if (!NODE_VERSION_PATTERN.test(requested))
      throw new Error(`not a Node.js version: ${requested}`);
    return requested;
  }
  const index = JSON.parse(await fetchText("https://nodejs.org/dist/index.json")) as {
    version: string;
  }[];
  const [pinnedMajor] = nodeRuntime.version.split(".");
  return latestInMajor(index, Number(pinnedMajor));
}

async function main(): Promise<void> {
  requireTool("gpg");
  requireTool("git");
  const version = await targetVersion(process.argv[2]);
  const scratch = await mkdtemp(join(tmpdir(), "valcloud-bump-node-"));
  try {
    const sha256 = parseShasums(await verifiedShasums(version, scratch), version);
    await writeFile(runtimePath, formatRuntime({ version, sha256 }));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  console.error(
    `Pinned Node.js ${version} in scripts/node-runtime.json (was ${nodeRuntime.version}).`,
    "Before releasing, check that the macOS floor in scripts/install.sh.in still equals the binaries' minos",
    "(vtool -show-build on both darwin binaries) and that the glibc floor still equals the highest GLIBC_ symbol of the linux binaries.",
  );
  console.log(`fix(runtime): bundle Node.js ${version}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
