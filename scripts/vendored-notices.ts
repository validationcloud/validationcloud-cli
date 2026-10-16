import { readFile } from "node:fs/promises";
import { posix } from "node:path";

export type NoticeEntry = { name: string; version: string; license: string; texts: string[] };

// Some packages ship pre-bundled chunks (the MCP client inlines ajv, fast-uri and others) and are installed without those inlined packages, so their licenses cannot be read from node_modules. The sourcemap beside a chunk names what was inlined; scripts/vendored-licenses.json holds the texts, and a package missing there fails the build.
export type VendoredLicenses = Record<string, { license: string; text: string }>;

// Entries look like ../../node_modules/.pnpm/@scope+name@1.2.3_peer@4/node_modules/@scope/name/dist/x.js. A node_modules source in any other shape is an error, because skipping it would drop its notice without a sound.
export function vendoredPackageIds(sources: string[]): string[] {
  const storeMarker = "node_modules/.pnpm/";
  const ids = new Set<string>();
  for (const source of sources) {
    const normalized = posix.normalize(source.replaceAll("\\", "/"));
    if (!normalized.includes("node_modules/")) continue;
    const at = normalized.indexOf(storeMarker);
    const segment =
      at === -1 ? "" : (normalized.slice(at + storeMarker.length).split("/")[0] ?? "");
    const id = segment.replace(/_.*$/u, "").replaceAll("+", "/");
    if (id.lastIndexOf("@") <= 0) {
      throw new Error(
        `cannot tell which package the sourcemap entry ${source} belongs to; extend vendoredPackageIds in scripts/third-party-notices.ts`,
      );
    }
    ids.add(id);
  }
  return [...ids].toSorted();
}

export function vendoredEntries(
  sources: string[],
  vendored: VendoredLicenses,
  covered: ReadonlySet<string>,
): NoticeEntry[] {
  return vendoredPackageIds(sources)
    .filter((id) => !covered.has(id))
    .map((id) => {
      const known = vendored[id];
      if (known === undefined) {
        throw new Error(
          `${id} is inlined into a bundled dependency but has no entry in scripts/vendored-licenses.json`,
        );
      }
      const at = id.lastIndexOf("@");
      return {
        name: id.slice(0, at),
        version: id.slice(at + 1),
        license: known.license,
        texts: [known.text],
      };
    });
}

// undefined when the file has no sourcemap beside it.
export async function readSourceMapSources(file: string): Promise<string[] | undefined> {
  let text: string;
  try {
    text = await readFile(`${file}.map`, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const map = JSON.parse(text) as { sources?: string[] };
  return map.sources ?? [];
}

// A bundled file without a sourcemap cannot be checked for inlined code, so each one is reviewed by hand: either its whole package (`packages`, for packages that ship no sourcemaps at all) or the single file (`files`, written as name/path-inside-the-package). An unlisted one fails the build until someone has looked.
export type ReviewedMapless = { packages: readonly string[]; files: readonly string[] };
export type MaplessInput = { name: string; file: string };

export function unreviewedInputs(inputs: MaplessInput[], reviewed: ReviewedMapless): string[] {
  return inputs
    .filter(
      ({ name, file }) =>
        !reviewed.packages.includes(name) && !reviewed.files.includes(`${name}/${file}`),
    )
    .map(({ name, file }) => `${name}/${file}`);
}
