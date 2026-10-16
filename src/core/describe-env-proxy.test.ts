import { describe, expect, it } from "vitest";
import { describeEnvProxy } from "./describe-env-proxy.ts";
import type { ProxyRuntime } from "./describe-env-proxy.ts";

const gateway = "https://mcp.example.test/mcp";
const proxy = "http://proxy.example.test:3128";
const on: readonly string[] = ["--use-env-proxy"];

function runtime(env: Record<string, string>, execArgv: readonly string[] = on): ProxyRuntime {
  return { env, execArgv };
}

describe("describeEnvProxy: which variable applies", () => {
  it.each<[string, Record<string, string>, string, string | undefined]>([
    ["HTTPS_PROXY for an https gateway", { HTTPS_PROXY: proxy }, gateway, "HTTPS_PROXY"],
    [
      "lowercase over uppercase",
      { HTTPS_PROXY: "http://upper.example.test:1", https_proxy: proxy },
      gateway,
      "https_proxy",
    ],
    [
      "HTTP_PROXY alone also carries an https gateway",
      { HTTP_PROXY: proxy },
      gateway,
      "HTTP_PROXY",
    ],
    [
      "http_proxy alone also carries an https gateway",
      { http_proxy: proxy },
      gateway,
      "http_proxy",
    ],
    [
      "https_proxy over http_proxy for an https gateway",
      { http_proxy: "http://plain.example.test:1", https_proxy: proxy },
      gateway,
      "https_proxy",
    ],
    [
      "an empty https_proxy hides HTTPS_PROXY and falls back to http_proxy",
      { https_proxy: "", HTTPS_PROXY: "http://upper.example.test:1", http_proxy: proxy },
      gateway,
      "http_proxy",
    ],
    [
      "an empty lowercase variable alone means no proxy",
      { https_proxy: "", HTTPS_PROXY: proxy },
      gateway,
      undefined,
    ],
    [
      "HTTP_PROXY for an http gateway",
      { HTTP_PROXY: proxy, HTTPS_PROXY: "http://x.example.test:1" },
      "http://localhost:8080/mcp",
      "HTTP_PROXY",
    ],
    [
      "HTTPS_PROXY alone does not carry an http gateway",
      { HTTPS_PROXY: proxy },
      "http://localhost:8080/mcp",
      undefined,
    ],
    ["no variable", {}, gateway, undefined],
  ])("%s", (_name, env, gatewayUrl, variable) => {
    expect(describeEnvProxy(runtime(env), gatewayUrl)?.variable).toBe(variable);
  });

  it.each([
    ["http://user:secret@proxy.example.test:3128/path", "http://proxy.example.test:3128"],
    ["proxy.example.test:3128", undefined],
  ])("reports %j as %j without credentials", (value, origin) => {
    expect(describeEnvProxy(runtime({ HTTPS_PROXY: value }), gateway)?.origin).toBe(origin);
  });
});

describe("describeEnvProxy: NO_PROXY", () => {
  it.each<[string, string, boolean]>([
    ["*", "*", true],
    ["an exact host", "mcp.example.test", true],
    ["a parent domain without a dot", "example.test", true],
    ["a leading dot", ".example.test", true],
    ["a wildcard", "*.example.test", true],
    ["another host", "other.test", false],
    ["a lookalike suffix", "xample.test", false],
    ["the port of the gateway", "mcp.example.test:443", true],
    ["another port", "mcp.example.test:8443", false],
    ["a list with whitespace", "localhost, other.test ,example.test", true],
    ["an empty list", "", false],
    ["the star inside a list", "localhost,*", false],
    ["a trailing dot", "mcp.example.test.", true],
  ])("%s (%j) exempts the gateway: %s", (_name, noProxy, exempt) => {
    const proxyApplies = describeEnvProxy(
      runtime({ HTTPS_PROXY: proxy, NO_PROXY: noProxy }),
      gateway,
    );
    expect(proxyApplies === undefined).toBe(exempt);
  });

  it("lets the lowercase no_proxy win, even when empty", () => {
    expect(
      describeEnvProxy(runtime({ HTTPS_PROXY: proxy, no_proxy: "", NO_PROXY: "*" }), gateway),
    ).toMatchObject({
      variable: "HTTPS_PROXY",
    });
  });

  it("matches the port of a gateway that names it", () => {
    const env = { HTTP_PROXY: proxy, NO_PROXY: "localhost:9000" };
    expect(describeEnvProxy(runtime(env), "http://localhost:9000/mcp")).toBeUndefined();
    expect(describeEnvProxy(runtime(env), "http://localhost:9001/mcp")).toMatchObject({
      variable: "HTTP_PROXY",
    });
  });
});

describe("describeEnvProxy: is the proxy variable read at all", () => {
  it.each<[string, Record<string, string>, readonly string[], boolean]>([
    ["neither the flag nor the variable", {}, [], false],
    ["--use-env-proxy", {}, ["--use-env-proxy"], true],
    ["--use-env-proxy=true", {}, ["--use-env-proxy=true"], true],
    ["--use-env-proxy=false", { NODE_USE_ENV_PROXY: "1" }, ["--use-env-proxy=false"], false],
    [
      "--no-use-env-proxy beats NODE_USE_ENV_PROXY",
      { NODE_USE_ENV_PROXY: "1" },
      ["--no-use-env-proxy"],
      false,
    ],
    ["NODE_USE_ENV_PROXY=1", { NODE_USE_ENV_PROXY: "1" }, [], true],
    ["NODE_USE_ENV_PROXY=0", { NODE_USE_ENV_PROXY: "0" }, [], false],
    ["the flag in NODE_OPTIONS", { NODE_OPTIONS: "--use-system-ca --use-env-proxy" }, [], true],
    ["a quoted NODE_OPTIONS", { NODE_OPTIONS: '--title="my app" "--use-env-proxy"' }, [], true],
    ["an underscore spelling", { NODE_OPTIONS: "--use_env_proxy" }, [], true],
    [
      "a flag value that is neither true nor false",
      { NODE_OPTIONS: "--use-env-proxy=maybe" },
      [],
      false,
    ],
    [
      "the command line after NODE_OPTIONS (off then on)",
      { NODE_OPTIONS: "--no-use-env-proxy" },
      ["--use-env-proxy"],
      true,
    ],
    [
      "the command line after NODE_OPTIONS (on then off)",
      { NODE_OPTIONS: "--use-env-proxy" },
      ["--no-use-env-proxy"],
      false,
    ],
    [
      "the last of several flags",
      {},
      ["--use-env-proxy", "--no-use-env-proxy", "--use-env-proxy"],
      true,
    ],
  ])("%s: %s", (_name, env, execArgv, reads) => {
    const found = describeEnvProxy({ env: { ...env, HTTPS_PROXY: proxy }, execArgv }, gateway);
    expect(found !== undefined).toBe(reads);
  });
});
