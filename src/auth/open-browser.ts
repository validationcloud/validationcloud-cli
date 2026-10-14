import { spawn } from "node:child_process";
import { parseBrowserUrl } from "#core/parse-browser-url";

export function openBrowser(url: string): Promise<boolean> {
  const parsed = parseBrowserUrl(url);
  if (!parsed.ok) return Promise.reject(new Error(parsed.error));
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  return new Promise((resolve) => {
    const child = spawn(command, [parsed.value.href], { stdio: "ignore", detached: true });
    child.once("error", () => {
      resolve(false);
    });
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}
