import { describe, expect, it } from "vitest";
import { parseBrowserUrl } from "./parse-browser-url.ts";

function accepted(raw: string): string | undefined {
  const result = parseBrowserUrl(raw);
  return result.ok ? result.value.href : undefined;
}

describe("parseBrowserUrl", () => {
  it("accepts an https URL", () => {
    expect(accepted("https://auth.example.com/authorize?state=abc")).toBe(
      "https://auth.example.com/authorize?state=abc",
    );
  });

  it("accepts http on localhost", () => {
    expect(accepted("http://localhost:4000/authorize")).toBe("http://localhost:4000/authorize");
  });

  it("accepts http on 127.0.0.1", () => {
    expect(accepted("http://127.0.0.1:4000/authorize")).toBe("http://127.0.0.1:4000/authorize");
  });

  it("accepts http on [::1]", () => {
    expect(accepted("http://[::1]:4000/authorize")).toBe("http://[::1]:4000/authorize");
  });

  it("refuses http on a remote host", () => {
    expect(parseBrowserUrl("http://auth.example.com/authorize")).toStrictEqual({
      ok: false,
      error: "refusing to open the authorization URL: plain http is allowed only on loopback",
    });
  });

  it("refuses http on a host that only starts with localhost", () => {
    expect(parseBrowserUrl("http://localhost.example.com/authorize")).toStrictEqual({
      ok: false,
      error: "refusing to open the authorization URL: plain http is allowed only on loopback",
    });
  });

  it("refuses a file URL", () => {
    expect(parseBrowserUrl("file:///etc/passwd")).toStrictEqual({
      ok: false,
      error: "refusing to open the authorization URL: scheme file: is not https: or loopback http:",
    });
  });

  it("refuses a script URL without echoing its payload", () => {
    expect(parseBrowserUrl("vbscript:msgbox(document.cookie)")).toStrictEqual({
      ok: false,
      error:
        "refusing to open the authorization URL: scheme vbscript: is not https: or loopback http:",
    });
  });

  it("refuses a string that is not a URL", () => {
    expect(parseBrowserUrl("not a url")).toStrictEqual({
      ok: false,
      error: "refusing to open the authorization URL: it is not a valid URL",
    });
  });
});
