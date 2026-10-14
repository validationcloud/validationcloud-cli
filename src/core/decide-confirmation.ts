export type ConfirmationInput = {
  destructive: boolean;
  yes: boolean;
  dryRun: boolean;
  noInteractive: boolean;
  ci: boolean;
  stdinConsumed: boolean;
  stdinIsTty: boolean;
};

export type RefusalReason = "no-interactive" | "ci" | "stdin-consumed" | "no-terminal";

export type ConfirmationDecision =
  | { kind: "proceed" }
  | { kind: "prompt" }
  | { kind: "refuse"; reason: RefusalReason };

const REFUSAL_EXPLANATIONS: Record<RefusalReason, string> = {
  "no-interactive": "--no-interactive was given",
  ci: "CI is set",
  "stdin-consumed": "--input - takes its input from standard input",
  "no-terminal": "there is no terminal to confirm on",
};

export function isCiEnvironment(value: string | undefined): boolean {
  return value !== undefined && !["", "0", "false"].includes(value.toLowerCase());
}

export function isAffirmative(answer: string): boolean {
  return /^y(?:es)?$/iu.test(answer.trim());
}

export function describeRefusal(reason: RefusalReason): string {
  return REFUSAL_EXPLANATIONS[reason];
}

export function decideConfirmation(input: ConfirmationInput): ConfirmationDecision {
  if (!input.destructive || input.yes || input.dryRun) return { kind: "proceed" };
  if (input.noInteractive) return { kind: "refuse", reason: "no-interactive" };
  if (input.ci) return { kind: "refuse", reason: "ci" };
  if (input.stdinConsumed) return { kind: "refuse", reason: "stdin-consumed" };
  if (!input.stdinIsTty) return { kind: "refuse", reason: "no-terminal" };
  return { kind: "prompt" };
}
