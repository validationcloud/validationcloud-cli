import { err, ok } from "./result.ts";
import type { Result } from "./result.ts";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function parseBrowserUrl(raw: string): Result<URL> {
  const url = URL.parse(raw);
  if (url === null) return err("refusing to open the authorization URL: it is not a valid URL");
  if (url.protocol === "https:") return ok(url);
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)) return ok(url);
  if (url.protocol === "http:") {
    return err("refusing to open the authorization URL: plain http is allowed only on loopback");
  }
  return err(
    `refusing to open the authorization URL: scheme ${url.protocol} is not https: or loopback http:`,
  );
}
