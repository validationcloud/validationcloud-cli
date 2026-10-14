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
      ["--conditions=vc-source", refreshWorkerPath, mode, credentialsPath, argument],
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
