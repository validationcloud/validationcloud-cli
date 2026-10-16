export const PLATFORMS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-x64",
  "linux-arm64",
  "linux-x64-musl",
] as const;

export type Platform = (typeof PLATFORMS)[number];
export type NodeRuntime = { version: string; sha256: Record<Platform, string> };
type NodeIndexEntry = { version: string };

export const NODE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export function parseShasums(shasums: string, version: string): Record<Platform, string> {
  const hashByFile = new Map<string, string>();
  for (const line of shasums.split("\n")) {
    const [hash, file] = line.split(/\s+/u);
    if (hash !== undefined && file !== undefined) hashByFile.set(file, hash);
  }
  const entries = PLATFORMS.map((platform) => {
    const file = `node-v${version}-${platform}.tar.gz`;
    const hash = hashByFile.get(file);
    if (hash === undefined || !SHA256_PATTERN.test(hash)) {
      throw new Error(`SHASUMS256.txt has no valid SHA-256 for ${file}`);
    }
    return [platform, hash] as const;
  });
  return Object.fromEntries(entries) as Record<Platform, string>;
}

function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (const [position, value] of left.entries()) {
    const difference = value - (right[position] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function latestInMajor(index: NodeIndexEntry[], major: number): string {
  const prefix = `v${major}.`;
  const newest = index
    .map((entry) => entry.version)
    .filter((version) => version.startsWith(prefix))
    .map((version) => version.slice(1))
    .filter((version) => NODE_VERSION_PATTERN.test(version))
    .toSorted(compareVersions)
    .at(-1);
  if (newest === undefined) throw new Error(`nodejs.org lists no Node.js ${major}.x release`);
  return newest;
}

// Statuses that mean the signature must not be trusted even if gpg exits 0: a revoked or expired key, a missing key, a bad or unverifiable signature.
const REJECTED_STATUSES = [
  "REVKEYSIG",
  "EXPKEYSIG",
  "EXPSIG",
  "KEYREVOKED",
  "ERRSIG",
  "BADSIG",
  "NO_PUBKEY",
] as const;

// gpg's --status-file output has GOODSIG and VALIDSIG lines only for a good signature; the last VALIDSIG field is the primary key, which is what the trusted list names.
export function trustedSigner(gpgStatus: string, trusted: readonly string[]): string {
  const lines = gpgStatus.split("\n");
  for (const status of REJECTED_STATUSES) {
    if (
      lines.some((line) => line === `[GNUPG:] ${status}` || line.startsWith(`[GNUPG:] ${status} `))
    ) {
      throw new Error(`gpg reported ${status} for SHASUMS256.txt.asc`);
    }
  }
  if (!lines.some((line) => line.startsWith("[GNUPG:] GOODSIG "))) {
    throw new Error("gpg did not report a good signature for SHASUMS256.txt.asc");
  }
  const fields = lines.find((line) => line.startsWith("[GNUPG:] VALIDSIG "))?.split(" ");
  const signer = fields?.[11] ?? fields?.[2];
  if (signer === undefined || !trusted.includes(signer)) {
    throw new Error(
      `SHASUMS256.txt.asc is signed by ${signer ?? "an unknown key"}, which is not in scripts/node-release-keys.json`,
    );
  }
  return signer;
}

export function formatRuntime(runtime: NodeRuntime): string {
  return `${JSON.stringify(runtime, null, 2)}\n`;
}
