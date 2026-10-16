export type EnvProxy = {
  variable: string;
  // The proxy URL without credentials, or undefined when it does not parse as a URL.
  origin: string | undefined;
};

export type ProxyRuntime = {
  env: Readonly<Record<string, string | undefined>>;
  execArgv: readonly string[];
};

const FLAG_NAME = "--use-env-proxy";
const NEGATED_FLAG_NAME = "--no-use-env-proxy";
const DEFAULT_PORTS: Readonly<Record<string, number>> = { "http:": 80, "https:": 443 };
const NODE_OPTION_TOKEN = /(?:"(?:\\.|[^"\\])*"|[^\s"])+/gu;
const QUOTED = /"(?<inner>(?:\\.|[^"\\])*)"/gu;

// Node splits NODE_OPTIONS on whitespace outside double quotes.
function tokenizeNodeOptions(raw: string): string[] {
  return [...raw.matchAll(NODE_OPTION_TOKEN)].map(([token]) =>
    token.replaceAll(QUOTED, (_quoted, inner: string) =>
      inner.replaceAll(/\\(?<char>.)/gu, "$<char>"),
    ),
  );
}

function flagValue(token: string): boolean | undefined {
  const [rawName = "", value] = token.split("=");
  const name = rawName.replaceAll("_", "-");
  if (name === FLAG_NAME) {
    if (value === undefined || value === "true") return true;
    return value === "false" ? false : undefined;
  }
  return name === NEGATED_FLAG_NAME && value === undefined ? false : undefined;
}

// Node reads NODE_OPTIONS before the command line, the last occurrence wins, and either beats NODE_USE_ENV_PROXY.
function readsProxyEnvironment({ env, execArgv }: ProxyRuntime): boolean {
  const tokens = [...tokenizeNodeOptions(env.NODE_OPTIONS ?? ""), ...execArgv];
  const flags = tokens.map((token) => flagValue(token)).filter((value) => value !== undefined);
  return flags.at(-1) ?? env.NODE_USE_ENV_PROXY === "1";
}

function originOf(proxyUrl: string): string | undefined {
  try {
    const { origin } = new URL(proxyUrl);
    return origin === "null" ? undefined : origin;
  } catch {
    return undefined;
  }
}

// An empty value counts as unset for the proxy itself, but an empty lowercase variable still hides its uppercase twin.
function pickVariable(
  lowercase: string,
  uppercase: string,
  env: ProxyRuntime["env"],
): string | undefined {
  const name = env[lowercase] === undefined ? uppercase : lowercase;
  return (env[name] ?? "") === "" ? undefined : name;
}

type NoProxyEntry = { hostname: string; port: number };

function parseNoProxyEntry(entry: string): NoProxyEntry {
  const ipv6WithPort = /^\[(?<host>.+)\]:(?<port>\d+)$/u.exec(entry);
  const unbracketed = entry.replace(/^\[(?<host>.+)\]$/u, "$<host>");
  const hostAndPort =
    unbracketed.split(":").length === 2 ? /^(?<host>.+):(?<port>\d+)$/u.exec(unbracketed) : null;
  const parsed = ipv6WithPort ?? hostAndPort;
  const host = parsed?.groups?.host ?? unbracketed;
  return {
    hostname: host
      .replace(/^\*?\./u, "")
      .replace(/^(?<name>.+)\.$/u, "$<name>")
      .toLowerCase(),
    port: Number(parsed?.groups?.port ?? 0),
  };
}

// Mirrors undici's EnvHttpProxyAgent, which decides per request whether the proxy applies.
function isExemptFromProxy(gateway: URL, noProxy: string): boolean {
  if (noProxy === "*") return true;
  const hostname = gateway.hostname
    .replace(/^\[(?<host>.+)\]$/u, "$<host>")
    .replace(/\.$/u, "")
    .toLowerCase();
  const port = gateway.port === "" ? (DEFAULT_PORTS[gateway.protocol] ?? 0) : Number(gateway.port);
  return noProxy
    .split(/[,\s]/u)
    .filter((entry) => entry !== "")
    .map((entry) => parseNoProxyEntry(entry))
    .some(
      (entry) =>
        (entry.port === 0 || entry.port === port) &&
        (hostname === entry.hostname || hostname.endsWith(`.${entry.hostname}`)),
    );
}

export function describeEnvProxy(runtime: ProxyRuntime, gatewayUrl: string): EnvProxy | undefined {
  if (!readsProxyEnvironment(runtime)) return undefined;
  const { env } = runtime;
  const gateway = new URL(gatewayUrl);
  if (isExemptFromProxy(gateway, env.no_proxy ?? env.NO_PROXY ?? "")) return undefined;
  const httpVariable = pickVariable("http_proxy", "HTTP_PROXY", env);
  const variable =
    gateway.protocol === "https:"
      ? (pickVariable("https_proxy", "HTTPS_PROXY", env) ?? httpVariable)
      : httpVariable;
  if (variable === undefined) return undefined;
  return { variable, origin: originOf(env[variable] ?? "") };
}
