import { spawn } from "node:child_process";
import { refreshWorkerPath } from "./auth-refresh-worker.ts";
import type { WorkerMode } from "./auth-refresh-worker.ts";

export type WorkerRun = { exitCode: number; stderr: string };

export function spawnWorker(
  mode: WorkerMode,
  credentialsPath: string,
  argument: string,
): Promise<WorkerRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        // Node before 22.18 needs the flag to run .ts files, and prints a warning on stderr that the tests compare with "".
        "--experimental-strip-types",
        "--disable-warning=ExperimentalWarning",
        "--conditions=vc-source",
        refreshWorkerPath,
        mode,
        credentialsPath,
        argument,
      ],
      {
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exitCode: code ?? -1, stderr });
    });
  });
}
