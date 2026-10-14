import { describe, expect, it } from "vitest";
import { resolveGateway } from "./resolve-gateway.ts";

describe("resolveGateway", () => {
  it("defaults to the built-in gateway", () => {
    expect(resolveGateway(undefined)).toStrictEqual({
      ok: true,
      value: { url: "https://mcp.validationcloud.io/mcp" },
    });
  });

  it("ignores an empty override", () => {
    expect(resolveGateway("")).toStrictEqual({
      ok: true,
      value: { url: "https://mcp.validationcloud.io/mcp" },
    });
  });

  it.each([
    ["https://mcp.example.test/mcp", "https://mcp.example.test/mcp"],
    ["http://localhost:8080/mcp", "http://localhost:8080/mcp"],
    ["http://127.0.0.1:8080/mcp", "http://127.0.0.1:8080/mcp"],
    ["http://[::1]:8080/mcp", "http://[::1]:8080/mcp"],
    ["https://Example.com", "https://example.com/"],
  ])("accepts %j", (urlOverride, url) => {
    expect(resolveGateway(urlOverride)).toStrictEqual({ ok: true, value: { url } });
  });

  it.each([
    "https://user:secret@mcp.example.test/mcp",
    "https://user@mcp.example.test/mcp",
    "http://:secret@localhost:8080/mcp",
  ])("rejects credentials in the URL %j without echoing them", (urlOverride) => {
    expect(resolveGateway(urlOverride)).toStrictEqual({
      ok: false,
      error: "VC_MCP_URL must not contain credentials (user:password@)",
    });
  });

  it.each([
    ["not a url", "VC_MCP_URL is not a valid URL"],
    ["http://example.com/mcp", "VC_MCP_URL must use https (http is allowed only for localhost)"],
    [
      "http://localhost.evil.com/mcp",
      "VC_MCP_URL must use https (http is allowed only for localhost)",
    ],
    ["ftp://localhost/mcp", "VC_MCP_URL must use https (http is allowed only for localhost)"],
  ])("rejects %j", (urlOverride, error) => {
    expect(resolveGateway(urlOverride)).toStrictEqual({ ok: false, error });
  });
});
