declare module "@semantic-release/commit-analyzer" {
  export function analyzeCommits(
    pluginConfig: unknown,
    context: {
      cwd: string;
      commits: { hash: string; message: string }[];
      logger: { log: (...args: unknown[]) => void };
    },
  ): Promise<string | null>;
}
