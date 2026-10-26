import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import type { AddressInfo, Server, Socket } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCredentialStore } from "#auth/credential-store";
import { startMockAuthorizationServer } from "./auth-mock-authorization-server.ts";
import { startStubMcpServer } from "./stub-mcp-server.ts";
import type { RecordedRequest, StubMcpServer } from "./stub-mcp-server.ts";

const root = join(import.meta.dirname, "..");
// pnpm run test:bundle points this at the release bundle so the shipped artifact runs the same scenarios.
const bundleEntry = process.env.VALCLOUD_ENTRY;
const cliEntry = bundleEntry ?? join(root, "bin", "valcloud");

// Payload {"exp":9999999999}: valid locally, yet the gateway may still answer 401.
const UNEXPIRED_ACCESS_TOKEN = "h.eyJleHAiOjk5OTk5OTk5OTl9.s";

type CliRun = { exitCode: number; stdout: string; stderr: string };
type CliOptions = {
  env?: Record<string, string | undefined>;
  home?: string;
  stdin?: string;
  keepStdinOpen?: boolean;
  nodeArgs?: string[];
  // Kills a CLI that hangs, so the failure is an assertion and not a vitest timeout with an orphan.
  killAfterMs?: number;
  // Leaves stdout unread for this long, like a slow consumer at the end of a pipe.
  stdoutReadDelayMs?: number;
  // Closes the read end of stdout right after the start, like `| true`.
  closeStdoutAtOnce?: boolean;
};
type PtyRun = { exitCode: number; timedOut: boolean; stdout: string; terminal: string };

let server: StubMcpServer;
let sharedHome: string;
const createdHomes: string[] = [];

function collect(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env: Record<string, string | undefined>;
    stdin?: string;
    keepStdinOpen?: boolean;
    killAfterMs?: number;
    stdoutReadDelayMs?: number;
    closeStdoutAtOnce?: boolean;
  },
): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const {
      stdin,
      keepStdinOpen,
      killAfterMs,
      stdoutReadDelayMs,
      closeStdoutAtOnce,
      ...spawnOptions
    } = options;
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: killAfterMs,
      ...spawnOptions,
    });
    if (closeStdoutAtOnce === true) child.stdout.destroy();
    if (stdoutReadDelayMs !== undefined) {
      child.stdout.pause();
      setTimeout(() => {
        child.stdout.resume();
      }, stdoutReadDelayMs);
    }
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
    if (keepStdinOpen !== true) child.stdin.end(stdin ?? "");
  });
}

async function freshHome(): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), "vc-integration-"));
  createdHomes.push(created);
  return created;
}

function credentialsDirectory(home: string): string {
  return process.platform === "darwin"
    ? join(home, "Library", "Preferences", "valcloud")
    : join(home, "config", "valcloud");
}

function cliEnvironment(home: string, env: Record<string, string | undefined> = {}) {
  return {
    PATH: process.env.PATH,
    HOME: home,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_CACHE_HOME: join(home, "cache"),
    VC_MCP_URL: server.url,
    VC_TOKEN: server.token,
    ...env,
  };
}

function runCli(args: string[], options: CliOptions = {}): Promise<CliRun> {
  return collect(process.execPath, [...(options.nodeArgs ?? []), cliEntry, ...args], {
    env: cliEnvironment(options.home ?? sharedHome, options.env),
    stdin: options.stdin,
    keepStdinOpen: options.keepStdinOpen,
    killAfterMs: options.killAfterMs,
    stdoutReadDelayMs: options.stdoutReadDelayMs,
    closeStdoutAtOnce: options.closeStdoutAtOnce,
  });
}

async function runCliInPty(
  answer: "y" | "n" | "eof" | "interrupt",
  args: string[],
  home: string,
): Promise<PtyRun> {
  const run = await collect(
    "python3",
    ["-I", join(root, "test", "pty-run.py"), answer, process.execPath, cliEntry, ...args],
    { env: cliEnvironment(home) },
  );
  return JSON.parse(run.stdout) as PtyRun;
}

function rpcMethods(): string[] {
  return server.requests.map((request) => request.rpcMethod);
}

function toolCalls(): RecordedRequest[] {
  return server.requests.filter((request) => request.rpcMethod === "tools/call");
}

async function catalogCacheFiles(home: string): Promise<string[]> {
  const entries = await readdir(home, { recursive: true });
  return entries.filter((entry) => basename(entry).startsWith("catalog-"));
}

async function onlyCatalogCachePath(home: string): Promise<string> {
  const files = await catalogCacheFiles(home);
  const [file] = files;
  if (files.length !== 1 || file === undefined) {
    throw new Error(`expected exactly one catalog cache file, found ${files.length}`);
  }
  return join(home, file);
}

async function closedLocalPort(): Promise<number> {
  const listener = createServer();
  await new Promise<void>((resolve) => {
    listener.listen(0, "127.0.0.1", resolve);
  });
  const { port } = listener.address() as AddressInfo;
  await new Promise<void>((resolve) => {
    listener.close(() => {
      resolve();
    });
  });
  return port;
}

async function startFakeProxy(
  onConnect: (socket: Socket) => void,
  sockets: Set<Socket>,
): Promise<Server> {
  const proxy = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => undefined);
    socket.once("data", () => {
      onConnect(socket);
    });
  });
  await new Promise<void>((resolve) => {
    proxy.listen(0, "127.0.0.1", resolve);
  });
  return proxy;
}

function proxyUrl(proxy: Server): string {
  return `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
}

async function buildFromSource(): Promise<void> {
  const build = await collect(
    join(root, "node_modules", ".bin", "tsc"),
    ["-p", "tsconfig.app.json"],
    { cwd: root, env: { PATH: process.env.PATH } },
  );
  if (build.exitCode !== 0) throw new Error(`build failed:\n${build.stdout}${build.stderr}`);
}

beforeAll(async () => {
  await (bundleEntry === undefined ? buildFromSource() : access(bundleEntry));
  server = await startStubMcpServer();
  sharedHome = await freshHome();
}, 120_000);

beforeEach(() => {
  server.requests.length = 0;
  server.setMode("ok");
});

afterAll(async () => {
  await server.close();
  await Promise.all(createdHomes.map((created) => rm(created, { recursive: true, force: true })));
});

describe("valcloud tool calls against a stateless MCP server", () => {
  it("prints a read-only result as a TSV table", async () => {
    const run = await runCli(["demo", "list-items"]);

    expect(run).toStrictEqual({
      exitCode: 0,
      stdout: 'ID\tNAME\tMETA.TIER\tTAGS\na1\tAlpha\tgold\t["x","y"]\nb2\tBeta\tsilver\t[]\n',
      stderr: "",
    });
  });

  it("prints compact structured JSON with --json when stdout is not a terminal", async () => {
    const run = await runCli(["demo", "get-item", "--id", "a1", "--json"]);

    expect(run).toStrictEqual({
      exitCode: 0,
      stdout: '{"id":"a1","name":"Alpha","notes":"line one\\nline two"}\n',
      stderr: "",
    });
  });

  it("accepts the single required property as a positional argument", async () => {
    const run = await runCli(["demo", "get-item", "a1"]);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe("id\ta1\nname\tAlpha\n\nnotes:\nline one\nline two\n");
    expect(toolCalls()).toStrictEqual([
      { rpcMethod: "tools/call", toolName: "demo.get_item", arguments: { id: "a1" } },
    ]);
  });

  it("exits 1 and prints the tool error on stderr when the tool returns isError", async () => {
    const run = await runCli(["demo", "get-item", "missing"]);

    expect(run).toStrictEqual({
      exitCode: 1,
      stdout: "",
      stderr: "valcloud: not_found: item not found\n",
    });
  });

  it("prints the tool error as JSON on stderr with --json", async () => {
    const run = await runCli(["demo", "get-item", "missing", "--json"]);

    expect(run).toStrictEqual({
      exitCode: 1,
      stdout: "",
      stderr: '{"error":{"code":"not_found","message":"item not found"}}\n',
    });
  });

  it("calls a destructive tool when --yes is given", async () => {
    const run = await runCli(["demo", "delete-item", "a1", "--yes"]);

    expect(run).toStrictEqual({ exitCode: 0, stdout: "deleted\ta1\n", stderr: "" });
    expect(toolCalls()).toStrictEqual([
      { rpcMethod: "tools/call", toolName: "demo.delete_item", arguments: { id: "a1" } },
    ]);
  });

  it("prints the resolved tool call for --dry-run without calling the tool or needing --yes", async () => {
    const run = await runCli(["demo", "delete-item", "a1", "--dry-run"]);

    expect(run).toStrictEqual({
      exitCode: 0,
      stdout: '{"tool":"demo.delete_item","arguments":{"id":"a1"}}\n',
      stderr: "",
    });
    expect(toolCalls()).toStrictEqual([]);
  });

  it("reads the arguments from stdin with --input -", async () => {
    const run = await runCli(["demo", "get-item", "--input", "-", "--json"], {
      stdin: '{"id":"b2"}',
    });

    expect(run.exitCode).toBe(0);
    expect(toolCalls()).toStrictEqual([
      { rpcMethod: "tools/call", toolName: "demo.get_item", arguments: { id: "b2" } },
    ]);
  });
});

describe("destructive confirmation", () => {
  it("refuses --input - without reading standard input", async () => {
    const run = await runCli(["demo", "delete-item", "--input", "-"], {
      home: await freshHome(),
      keepStdinOpen: true,
    });

    expect(run.exitCode).toBe(2);
    expect(run.stderr).toContain("--input - takes its input from standard input");
  });

  it.each([
    [
      "there is no terminal",
      ["demo", "delete-item", "a1"],
      {},
      "valcloud: demo.delete_item is destructive and cannot be confirmed: there is no terminal to confirm on\nhint: pass --yes to proceed with 'valcloud demo delete-item', or --dry-run to preview\n",
    ],
    [
      "CI is set",
      ["demo", "delete-item", "a1"],
      { env: { CI: "true" } },
      "valcloud: demo.delete_item is destructive and cannot be confirmed: CI is set\nhint: pass --yes to proceed with 'valcloud demo delete-item', or --dry-run to preview\n",
    ],
    [
      "--no-interactive is given",
      ["demo", "delete-item", "a1", "--no-interactive"],
      {},
      "valcloud: demo.delete_item is destructive and cannot be confirmed: --no-interactive was given\nhint: pass --yes to proceed with 'valcloud demo delete-item', or --dry-run to preview\n",
    ],
    [
      "--input - consumed stdin",
      ["demo", "delete-item", "--input", "-"],
      { stdin: '{"id":"a1"}' },
      "valcloud: demo.delete_item is destructive and cannot be confirmed: --input - takes its input from standard input\nhint: pass --yes to proceed with 'valcloud demo delete-item', or --dry-run to preview\n",
    ],
  ] as const)(
    "refuses without --yes and names the reason when %s",
    async (_label, args, options, stderr) => {
      const run = await runCli([...args], { home: await freshHome(), ...options });

      expect(run).toStrictEqual({
        exitCode: 2,
        stdout: "",
        stderr,
      });
      expect(toolCalls()).toStrictEqual([]);
    },
  );

  it("never touches the network to refuse when the cached catalog is stale", async () => {
    const home = await freshHome();
    await runCli(["demo", "list-items"], { home });
    const cachePath = await onlyCatalogCachePath(home);
    const cache = JSON.parse(await readFile(cachePath, "utf8")) as { fetchedAtMs: number };
    await writeFile(cachePath, JSON.stringify({ ...cache, fetchedAtMs: 0 }));
    server.requests.length = 0;

    const run = await runCli(["demo", "delete-item", "a1"], { home });

    expect(run.exitCode).toBe(2);
    expect(server.requests).toStrictEqual([]);
  });

  it("proceeds when the answer at the terminal prompt is y", async () => {
    const run = await runCliInPty("y", ["demo", "delete-item", "a1"], await freshHome());

    expect(run).toMatchObject({ exitCode: 0, timedOut: false, stdout: "deleted\ta1\n" });
    expect(run.terminal).toContain("valcloud demo delete-item is destructive. Continue? [y/N] ");
    expect(toolCalls()).toHaveLength(1);
  });

  it("aborts with exit 1 when the answer at the terminal prompt is n", async () => {
    const run = await runCliInPty("n", ["demo", "delete-item", "a1"], await freshHome());

    expect(run).toMatchObject({ exitCode: 1, timedOut: false, stdout: "" });
    expect(run.terminal).toContain("valcloud: aborted");
    expect(toolCalls()).toStrictEqual([]);
  });

  it("aborts with exit 1 when the terminal prompt gets EOF", async () => {
    const run = await runCliInPty("eof", ["demo", "delete-item", "a1"], await freshHome());

    expect(run).toMatchObject({ exitCode: 1, timedOut: false, stdout: "" });
    expect(run.terminal).toContain("valcloud: aborted");
    expect(toolCalls()).toStrictEqual([]);
  });

  it("exits 130 when Ctrl-C interrupts the terminal prompt", async () => {
    const run = await runCliInPty("interrupt", ["demo", "delete-item", "a1"], await freshHome());

    expect(run).toMatchObject({ exitCode: 130, timedOut: false, stdout: "" });
    expect(toolCalls()).toStrictEqual([]);
  });
});

describe("catalog cache", () => {
  it("sends only server/discover, tools/list and tools/call on a cold cache", async () => {
    await runCli(["demo", "list-items"], { home: await freshHome() });

    expect(rpcMethods()).toStrictEqual(["server/discover", "tools/list", "tools/call"]);
  });

  it("sends only tools/call once the cache is warm", async () => {
    const home = await freshHome();
    await runCli(["demo", "list-items"], { home });
    server.requests.length = 0;

    await runCli(["demo", "list-items"], { home });

    expect(rpcMethods()).toStrictEqual(["tools/call"]);
  });

  it("keeps the cached catalog when tools --refresh fails", async () => {
    const home = await freshHome();
    await runCli(["demo", "list-items"], { home });
    server.setMode("unavailable");

    const refresh = await runCli(["tools", "--refresh"], { home });
    server.setMode("ok");
    server.requests.length = 0;
    const next = await runCli(["demo", "list-items"], { home });

    expect(refresh.exitCode).toBe(1);
    expect(next.exitCode).toBe(0);
    expect(rpcMethods()).toStrictEqual(["tools/call"]);
  });

  it("discards the cached catalog when the server rejects a cached tool with -32602", async () => {
    const home = await freshHome();
    await runCli(["tools"], { home });
    server.setMode("ghost-removed");
    const first = await runCli(["demo", "ghost"], { home });
    await expect(catalogCacheFiles(home)).resolves.toStrictEqual([]);
    server.requests.length = 0;

    const second = await runCli(["demo", "list-items"], { home });

    expect(first).toStrictEqual({
      exitCode: 1,
      stdout: "",
      stderr:
        "valcloud: protocol_error: Tool demo.ghost not found (JSON-RPC error -32602)\nhint: the tool list may be out of date; run 'valcloud tools --refresh' and retry\n",
    });
    expect(second.exitCode).toBe(0);
    expect(rpcMethods()).toStrictEqual(["server/discover", "tools/list", "tools/call"]);
  });

  it("reports the JSON-RPC code in --json output", async () => {
    const home = await freshHome();
    await runCli(["tools"], { home });
    server.setMode("ghost-removed");

    const run = await runCli(["demo", "ghost", "--json"], { home });

    expect(run.exitCode).toBe(1);
    expect(JSON.parse(run.stderr)).toStrictEqual({
      error: {
        code: "protocol_error",
        message: "Tool demo.ghost not found (JSON-RPC error -32602)",
        rpc_code: -32_602,
        hint: "the tool list may be out of date; run 'valcloud tools --refresh' and retry",
      },
    });
  });
});

describe("valcloud tools", () => {
  const unmappedNotes =
    "valcloud: note: demo.listItems has no command: the command 'valcloud demo list-items' is already taken by demo.list_items\n" +
    "valcloud: note: auth.status has no command: the namespace 'auth' is a built-in valcloud command\n";

  it("lists each tool with its safety flags and full description, and the unmapped tools on stderr", async () => {
    const run = await runCli(["tools"], { home: await freshHome() });

    expect(run).toStrictEqual({
      exitCode: 0,
      stdout:
        "valcloud demo list-items\ntool: demo.list_items\nread-only: true\ndestructive: false\n\n  List the demo items.\n\n" +
        "valcloud demo get-item\ntool: demo.get_item\nread-only: true\ndestructive: false\n\n  Get one demo item. Items are free to read and need no approval.\n\n" +
        "valcloud demo delete-item\ntool: demo.delete_item\nread-only: false\ndestructive: true\n\n  Delete one demo item.\n\n" +
        "valcloud demo ghost\ntool: demo.ghost\nread-only: true\ndestructive: false\n\n  A tool the server may remove.\n",
      stderr: unmappedNotes,
    });
  });

  it("returns the full description of each tool in --json", async () => {
    const run = await runCli(["tools", "--json"], { home: await freshHome() });

    expect(run.exitCode).toBe(0);
    const { tools } = JSON.parse(run.stdout) as { tools: { tool: string; description: string }[] };
    expect(tools.find((entry) => entry.tool === "demo.get_item")?.description).toBe(
      "Get one demo item. Items are free to read and need no approval.",
    );
  });

  it("lists the unmapped tools with a reason in --json", async () => {
    const run = await runCli(["tools", "--json"], { home: await freshHome() });

    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({
      unmapped: [
        {
          tool: "demo.listItems",
          reason: "the command 'valcloud demo list-items' is already taken by demo.list_items",
        },
        { tool: "auth.status", reason: "the namespace 'auth' is a built-in valcloud command" },
      ],
    });
  });
});

describe("failure reporting", () => {
  it("exits 3 and tells the user to fix VC_TOKEN when the server rejects it", async () => {
    const run = await runCli(["demo", "list-items"], {
      env: { VC_TOKEN: "wrong" },
      home: await freshHome(),
    });

    expect(run).toStrictEqual({
      exitCode: 3,
      stdout: "",
      stderr:
        "valcloud: the gateway rejected VC_TOKEN (HTTP 401)\nhint: fix or unset VC_TOKEN (stored credentials are used when it is unset)\n",
    });
  });

  it("exits 3 with a login hint when there are no credentials", async () => {
    const run = await runCli(["demo", "list-items"], {
      env: { VC_TOKEN: undefined, VC_MCP_URL: "https://mcp.example.test/mcp" },
    });

    expect(run).toStrictEqual({
      exitCode: 3,
      stdout: "",
      stderr:
        "valcloud: not logged in to https://mcp.example.test/mcp, so tool commands are unavailable\nhint: run 'valcloud auth login'\n",
    });
  });

  it("exits 1 naming the gateway when it cannot be reached", async () => {
    const url = `http://127.0.0.1:${await closedLocalPort()}/mcp`;

    const run = await runCli(["demo", "list-items"], {
      env: { VC_MCP_URL: url },
      home: await freshHome(),
    });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toBe(
      `valcloud: cannot reach ${url} (ECONNREFUSED)\nhint: check your network, or set VC_MCP_URL to another gateway\n`,
    );
  });

  it("exits 2 when VC_MCP_URL carries credentials, without echoing them", async () => {
    const run = await runCli(["tools"], {
      env: { VC_MCP_URL: "https://user:hunter2@mcp.example.test/mcp" },
    });

    expect(run).toStrictEqual({
      exitCode: 2,
      stdout: "",
      stderr: "valcloud: VC_MCP_URL must not contain credentials (user:password@)\n",
    });
  });

  it("prints a usage error as one line plus the --help hint", async () => {
    const run = await runCli(["demo", "get-item", "--bogus"]);

    expect(run).toStrictEqual({
      exitCode: 2,
      stdout: "",
      stderr: "valcloud: unknown option '--bogus'\n(add --help for additional information)\n",
    });
  });

  it("rejects the removed --env flag as a usage error", async () => {
    const run = await runCli(["--env", "x", "tools"], {
      home: await freshHome(),
      env: { VC_TOKEN: undefined },
    });

    expect(run).toStrictEqual({
      exitCode: 2,
      stdout: "",
      stderr: "valcloud: unknown option '--env'\n(add --help for additional information)\n",
    });
  });

  it("prints a usage error as JSON with --json", async () => {
    const run = await runCli(["demo", "get-item", "--bogus", "--json"]);

    expect(run).toStrictEqual({
      exitCode: 2,
      stdout: "",
      stderr: '{"error":{"code":"usage_error","message":"unknown option \'--bogus\'"}}\n',
    });
  });
});

// Node 22.12 predates --use-env-proxy, and without it the CLI would try to reach the host directly.
describe.skipIf(!process.allowedNodeEnvironmentFlags.has("--use-env-proxy"))(
  "a broken HTTP proxy",
  () => {
    const unreachableGateway = "https://mcp.example.test/mcp";
    const timeoutMs = 1500;
    const proxies: Server[] = [];
    const proxySockets = new Set<Socket>();

    async function brokenProxy(onConnect: (socket: Socket) => void): Promise<string> {
      const proxy = await startFakeProxy(onConnect, proxySockets);
      proxies.push(proxy);
      return proxyUrl(proxy);
    }

    afterAll(async () => {
      await Promise.all(
        proxies.map(
          (proxy) =>
            new Promise<void>((resolve) => {
              proxy.close(() => {
                resolve();
              });
              for (const socket of proxySockets) socket.destroy();
            }),
        ),
      );
    });

    async function runBehindProxy(args: string[], proxy: string, env: Record<string, string> = {}) {
      return runCli(args, {
        home: await freshHome(),
        nodeArgs: ["--use-env-proxy", "--use-system-ca"],
        killAfterMs: 20_000,
        env: {
          VC_MCP_URL: unreachableGateway,
          HTTPS_PROXY: proxy,
          VC_REQUEST_TIMEOUT_MS: String(timeoutMs),
          ...env,
        },
      });
    }

    it("exits 1 and blames the proxy when it closes the connection during CONNECT", async () => {
      const proxy = await brokenProxy((socket) => {
        socket.end();
      });

      const run = await runBehindProxy(["tools"], proxy);

      expect(run.exitCode).toBe(1);
      // Node 24's undici reconnects forever, so the timeout ends the run; newer Node fails at once.
      expect(run.stderr).toMatch(
        /^valcloud: (?:no response from https:\/\/mcp\.example\.test\/mcp within 1500 ms|cannot reach https:\/\/mcp\.example\.test\/mcp \(UND_ERR_SOCKET\))\n/u,
      );
      expect(run.stderr).toContain(
        `hint: the proxy set in HTTPS_PROXY (${proxy}) is the likely cause`,
      );
    });

    it("exits 1 and blames the proxy when it accepts the connection and never answers", async () => {
      const proxy = await brokenProxy(() => undefined);

      const run = await runBehindProxy(["tools"], proxy);

      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain(
        "valcloud: no response from https://mcp.example.test/mcp within 1500 ms\n",
      );
      expect(run.stderr).toContain(`the proxy set in HTTPS_PROXY (${proxy}) is the likely cause`);
    });

    it("bounds a tool call that runs with a cached catalog, through the proxy", async () => {
      const home = await freshHome();
      const warmUp = await runCli(["tools"], { home });
      expect(warmUp.exitCode).toBe(0);
      const proxy = await brokenProxy(() => undefined);

      const run = await runCli(["demo", "get-item", "a1"], {
        home,
        nodeArgs: ["--use-env-proxy", "--use-system-ca"],
        killAfterMs: 20_000,
        env: { HTTP_PROXY: proxy, VC_REQUEST_TIMEOUT_MS: String(timeoutMs) },
      });

      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain(`no response from ${server.url} within 1500 ms`);
      expect(run.stderr).toContain(`the proxy set in HTTP_PROXY (${proxy}) is the likely cause`);
    });
  },
);

describe("the request timeout setting", () => {
  it("exits 2 when VC_REQUEST_TIMEOUT_MS is not a whole number of milliseconds", async () => {
    const run = await runCli(["tools"], { env: { VC_REQUEST_TIMEOUT_MS: "soon" } });

    expect(run).toStrictEqual({
      exitCode: 2,
      stdout: "",
      stderr:
        "valcloud: VC_REQUEST_TIMEOUT_MS must be a whole number of milliseconds between 1 and 2147483647\n",
    });
  });
});

describe("a failing run whose stdout reader is gone", () => {
  it("still exits with the failure code", async () => {
    const url = `http://127.0.0.1:${await closedLocalPort()}/mcp`;

    const run = await runCli(["tools"], {
      env: { VC_MCP_URL: url },
      home: await freshHome(),
      closeStdoutAtOnce: true,
      killAfterMs: 20_000,
    });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`cannot reach ${url}`);
  });
});

describe("a token refresh that outlives the request timeout", () => {
  // The gateway holds its 401 for 6 s, so the refresh starts 6 s into the 7.5 s limit and its own 7.5 s bound ends 6 s after the limit.
  // Releasing the refresh 3 s after the limit leaves 3 s of slack on both sides, whatever the machine's speed.
  const requestTimeoutMs = 7500;
  const gatewayHoldMs = 6000;
  const refreshReleaseAfterArrivalMs = 4500;

  it("is finished before the process exits, so the rotated token is stored and the lock is gone", async () => {
    const mock = await startMockAuthorizationServer({
      refreshDelayMs: 0,
      reuseDelayMs: 0,
      gatedGateway: true,
      gatedRefresh: true,
    });
    try {
      const home = await freshHome();
      const directory = credentialsDirectory(home);
      const store = createCredentialStore(join(directory, "credentials.json"));
      mock.acceptRefreshToken("rt-seed");
      await store.update(mock.mcpUrl, () => ({
        client: { client_id: "cli-client", issuer: mock.issuer },
        tokens: {
          access_token: UNEXPIRED_ACCESS_TOKEN,
          token_type: "Bearer",
          refresh_token: "rt-seed",
          issuer: mock.issuer,
        },
        tokensSavedAtMs: Date.now(),
      }));

      const running = runCli(["tools"], {
        home,
        env: {
          VC_TOKEN: undefined,
          VC_MCP_URL: mock.mcpUrl,
          VC_REQUEST_TIMEOUT_MS: String(requestTimeoutMs),
        },
        killAfterMs: 30_000,
      });
      await mock.gateway.arrived;
      await sleep(gatewayHoldMs);
      mock.gateway.release();
      await mock.refresh.arrived;
      await sleep(refreshReleaseAfterArrivalMs);
      mock.refresh.release();
      const run = await running;

      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain(`no response from ${mock.mcpUrl} within 7500 ms`);
      const entry = await store.read(mock.mcpUrl);
      expect(entry?.tokens?.refresh_token).toBe("rt-1");
      await expect(readdir(directory)).resolves.toStrictEqual(["credentials.json"]);
    } finally {
      await mock.close();
    }
  });
});

describe("a long result written to a slow pipe", () => {
  it("is delivered in full before the explicit exit", async () => {
    const id = "x".repeat(3_000_000);

    const run = await runCli(["demo", "get-item", "--input", "-", "--json"], {
      stdin: JSON.stringify({ id }),
      stdoutReadDelayMs: 500,
      killAfterMs: 20_000,
    });

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toHaveLength(3_000_054);
    expect(run.stdout.endsWith('"notes":"line one\\nline two"}\n')).toBe(true);
  });
});

describe("valcloud --help", () => {
  it("lists generic examples instead of tool names", async () => {
    const run = await runCli(["--help"]);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("valcloud <namespace> <command> --help");
    expect(run.stdout).not.toContain("nodeapi");
  });

  it("counts tools per namespace from the --json list, which `valcloud tools --json` provides", async () => {
    const help = await runCli(["--help"]);
    const list = await runCli(["tools", "--json"]);
    const parsed = JSON.parse(list.stdout) as { tools: { namespace: string }[] };

    expect(help.stdout).toContain(
      "valcloud tools --json | jq -r '.tools[].namespace' | sort | uniq -c",
    );
    expect(help.stdout).not.toContain("tail -n +2");
    expect(parsed.tools.map((tool) => tool.namespace)).toContain("demo");
  });

  it("documents VC_MCP_URL and has no --env flag", async () => {
    const run = await runCli(["--help"]);

    expect(run.stdout).toContain("VC_MCP_URL  Point valcloud at a different MCP gateway");
    expect(run.stdout).not.toContain("--env");
  });
});

describe("valcloud auth status", () => {
  it("shows the built-in gateway URL by default", async () => {
    const run = await runCli(["auth", "status", "--json"], {
      home: await freshHome(),
      env: { VC_MCP_URL: undefined },
    });

    expect(JSON.parse(run.stdout)).toMatchObject({ url: "https://mcp.validationcloud.io/mcp" });
  });

  it("reports a VC_TOKEN without a readable expiry as not verified", async () => {
    const run = await runCli(["auth", "status", "--json"], { home: await freshHome() });

    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({
      logged_in: true,
      verified: false,
      source: "VC_TOKEN",
      expires_at: null,
    });
  });

  it("says in text mode that the token was not verified locally", async () => {
    const run = await runCli(["auth", "status"], { home: await freshHome() });

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe("valcloud: note: token not verified locally (no readable expiry)\n");
  });
});

describe("a corrupt credentials.json", () => {
  const secretFragment = "SECRET-FRAGMENT-9f3a";

  async function homeWithCorruptCredentials(): Promise<{ home: string; file: string }> {
    const home = await freshHome();
    const directory = credentialsDirectory(home);
    await mkdir(directory, { recursive: true });
    const file = join(directory, "credentials.json");
    await writeFile(
      file,
      `{"https://mcp.validationcloud.io/mcp":{"tokens":{"access_token":"${secretFragment}`,
    );
    return { home, file };
  }

  it("still renders --help with a note in the help text and no file content", async () => {
    const { home } = await homeWithCorruptCredentials();

    const run = await runCli(["--help"], { home, env: { VC_TOKEN: undefined } });

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("Usage: valcloud");
    expect(run.stdout).toContain("Tool commands could not be loaded (credentials file");
    expect(run.stdout).not.toContain(secretFragment);
    expect(run.stderr).toBe("");
  });

  it("makes auth status fail with a fixed message that names the file", async () => {
    const { home, file } = await homeWithCorruptCredentials();

    const run = await runCli(["auth", "status"], { home, env: { VC_TOKEN: undefined } });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(file);
    expect(run.stderr).toContain("valcloud auth logout");
    expect(run.stderr).not.toContain(secretFragment);
    expect(run.stderr).not.toContain("JSON");
  });

  it("lets auth logout remove the file and say so on stderr", async () => {
    const { home, file } = await homeWithCorruptCredentials();

    const run = await runCli(["auth", "logout"], { home, env: { VC_TOKEN: undefined } });

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toBe(`valcloud: removed the unreadable credentials file (${file})\n`);
    await expect(access(file)).rejects.toThrow("ENOENT");
  });
});
