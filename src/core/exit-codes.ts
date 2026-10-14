export const FailureKind = {
  tool: "tool",
  runtime: "runtime",
  usage: "usage",
  auth: "auth",
} as const;

export type FailureKind = (typeof FailureKind)[keyof typeof FailureKind];

const EXIT_CODES = {
  success: { code: 0, meaning: "success" },
  runtime: {
    code: 1,
    meaning: "tool or runtime error (the tool reported an error, network failure)",
  },
  usage: {
    code: 2,
    meaning: "usage error (bad flags or arguments, destructive call without --yes)",
  },
  auth: { code: 3, meaning: "authentication required or failed" },
} as const;

export function exitCodeFor(kind: FailureKind): number {
  return EXIT_CODES[kind === "tool" ? "runtime" : kind].code;
}

export function renderExitCodeHelp(): string {
  return Object.values(EXIT_CODES)
    .map(({ code, meaning }) => `  ${code}  ${meaning}`)
    .join("\n");
}
