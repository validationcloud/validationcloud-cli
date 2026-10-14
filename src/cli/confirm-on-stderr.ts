import { createInterface } from "node:readline";
import { isAffirmative } from "#core/decide-confirmation";

export type Confirmation = "yes" | "no" | "interrupted";

export function confirmOnStderr(question: string): Promise<Confirmation> {
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  let settled = false;
  return new Promise<Confirmation>((resolve) => {
    const settle = (confirmation: Confirmation, endLine: boolean): void => {
      if (settled) return;
      settled = true;
      if (endLine) process.stderr.write("\n");
      resolve(confirmation);
    };
    // EOF closes the interface without an answer; that counts as "no" instead of leaving the promise pending.
    readline.once("close", () => {
      settle("no", true);
    });
    readline.once("SIGINT", () => {
      settle("interrupted", true);
    });
    readline.question(`${question} [y/N] `, (answer) => {
      settle(isAffirmative(answer) ? "yes" : "no", false);
    });
  }).finally(() => {
    readline.close();
  });
}
