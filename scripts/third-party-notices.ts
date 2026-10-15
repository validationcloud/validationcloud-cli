import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { readSourceMapSources, unreviewedInputs, vendoredEntries } from "./vendored-notices.ts";
import type {
  MaplessInput,
  NoticeEntry,
  ReviewedMapless,
  VendoredLicenses,
} from "./vendored-notices.ts";

const NOTICE_FILE_PATTERN = /^(?:licen[cs]e|notice|copying)(?:[.-].*)?$/iu;

// Input paths from esbuild's metafile look like node_modules/.pnpm/x@1/node_modules/@scope/name/dist/a.js; the package directory ends at the last node_modules segment.
export function packageDirectories(inputs: string[], root: string): string[] {
  const marker = `${sep}node_modules${sep}`;
  const directories = new Set<string>();
  for (const input of inputs) {
    const path = resolve(root, input);
    const at = path.lastIndexOf(marker);
    if (at === -1) continue;
    const [first, second] = path.slice(at + marker.length).split(sep);
    if (first === undefined) continue;
    const segments = first.startsWith("@") && second !== undefined ? [first, second] : [first];
    directories.add(join(path.slice(0, at), "node_modules", ...segments));
  }
  return [...directories].toSorted();
}

export function formatNotices(entries: NoticeEntry[]): string {
  const sections = entries.map((entry) => {
    const heading = `${entry.name}@${entry.version} (${entry.license})`;
    return [heading, "=".repeat(heading.length), ...entry.texts.map((text) => text.trim())].join(
      "\n\n",
    );
  });
  return `${sections.join("\n\n\n")}\n`;
}

// A license text containing the comment terminator would end the comment early.
export function asBlockComment(text: string): string {
  return `/*!\n${text.replaceAll("*/", "* /")}*/\n`;
}

export async function readNoticeEntry(directory: string): Promise<NoticeEntry> {
  const manifestText = await readFile(join(directory, "package.json"), "utf8");
  const manifest = JSON.parse(manifestText) as {
    name: string;
    version: string;
    license?: string;
  };
  const entries = await readdir(directory);
  const files = entries.filter((file) => NOTICE_FILE_PATTERN.test(file));
  if (files.length === 0) {
    throw new Error(`${manifest.name}@${manifest.version} is bundled but ships no LICENSE file`);
  }
  const texts = await Promise.all(
    files.toSorted().map((file) => readFile(join(directory, file), "utf8")),
  );
  return {
    name: manifest.name,
    version: manifest.version,
    license: manifest.license ?? "see text",
    texts,
  };
}

// The package a bundled file belongs to and the file's path inside it.
function packageFile(input: string, root: string): MaplessInput {
  const path = resolve(root, input);
  const [directory] = packageDirectories([input], root);
  if (directory === undefined) throw new Error(`${input} is not inside node_modules`);
  const marker = `${sep}node_modules${sep}`;
  return {
    name: directory
      .slice(directory.lastIndexOf(marker) + marker.length)
      .split(sep)
      .join("/"),
    file: relative(directory, path).split(sep).join("/"),
  };
}

export async function collectNotices(
  inputs: string[],
  root: string,
  vendored: VendoredLicenses,
  reviewed: ReviewedMapless,
): Promise<NoticeEntry[]> {
  const direct = await Promise.all(
    packageDirectories(inputs, root).map((directory) => readNoticeEntry(directory)),
  );
  const covered = new Set(direct.map((entry) => `${entry.name}@${entry.version}`));
  const packageInputs = inputs.filter((input) => input.includes("node_modules"));
  const sourceLists = await Promise.all(
    packageInputs.map(async (input) => ({
      input,
      sources: await readSourceMapSources(resolve(root, input)),
    })),
  );
  const unreviewed = unreviewedInputs(
    sourceLists
      .filter((entry) => entry.sources === undefined)
      .map((entry) => packageFile(entry.input, root)),
    reviewed,
  );
  if (unreviewed.length > 0) {
    throw new Error(
      `${unreviewed.join(", ")} have no sourcemap, so code inlined in them cannot be listed; check each one and add it to scripts/bundled-packages.json`,
    );
  }
  const inlined = vendoredEntries(
    sourceLists.flatMap((entry) => entry.sources ?? []),
    vendored,
    covered,
  );
  return [...direct, ...inlined].toSorted((a, b) => a.name.localeCompare(b.name));
}
