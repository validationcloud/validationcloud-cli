# vcloud

`vcloud` is the command-line companion to Validation Cloud's MCP server. It is an MCP client: the gateway's tool list is fetched at runtime, and every tool becomes a subcommand, so new gateway tools show up without a CLI release.

```console
$ vcloud nodeapi list-chains
$ vcloud nodeapi get-endpoint 3f2c0c9e-0000-0000-0000-000000000000 --json
$ vcloud tools
```

## Install

This package is private and is installed from a checkout. Node.js 24.15 or newer and pnpm are required.

```bash
pnpm install && pnpm build && pnpm link --global   # then run: vcloud --help
node bin/vcloud --help                                   # or run it straight from the checkout
```

## Log in

```bash
vcloud auth login            # opens a browser; OAuth authorization code with PKCE
vcloud auth login --no-browser   # only print the URL
vcloud auth status           # gateway URL, logged-in state, expiry, subject (no secrets)
vcloud auth token            # print the access token, refreshing it first if expired
vcloud auth logout           # delete this gateway's stored credentials
```

Login listens on `http://localhost:38417/callback` for the redirect and gives up after 5 minutes. If that port is in use the command fails and names it. Device-code login is not offered because Auth0 rejects it for dynamically registered clients. Expired access tokens are refreshed automatically; if the refresh fails, `vcloud` exits with code 3 and tells you to run `vcloud auth login` again.

Set `VC_TOKEN` to use a bearer token you already have. It takes precedence over stored credentials and is never refreshed.

## Gateway

`vcloud` talks to `https://mcp.validationcloud.io/mcp`. Set `VC_MCP_URL` to point it at a different MCP gateway (development, self-hosted), for example `VC_MCP_URL=https://mcp.example.test/mcp vcloud tools`; it replaces the built-in gateway for that run and must be https, or http on localhost only. Credentials and the tool catalog are kept per gateway URL, so each gateway has its own login and tool list.

## Tools become commands

`vcloud <namespace> <command> [options]`. The namespace is the part of the tool name before the first dot, and names are kebab-cased from snake_case and camelCase:

| Tool                    | Command                         |
| ----------------------- | ------------------------------- |
| `nodeapi.get_endpoint`  | `vcloud nodeapi get-endpoint`   |
| `mavrik.answerQuestion` | `vcloud mavrik answer-question` |

Each property of a tool's input schema becomes a `--kebab-case` flag, with the tool's descriptions in `--help`:

- strings, integers and numbers take a value, and invalid numbers are a usage error;
- booleans are `--flag` and `--no-flag`;
- enums are validated, and their values are listed in `--help`;
- objects and arrays take a JSON value.

Required properties are required options. When exactly one property is required it can also be given as a positional argument: `vcloud nodeapi get-endpoint <id>` equals `--id <id>`. `--input '<json>'` (or `--input -` for stdin) supplies the whole arguments object, and explicit flags override it.

`vcloud tools` lists the available commands with `read-only` and `destructive` flags (`--json` for JSON, `--refresh` to refetch the catalog). The catalog is cached for one hour and is refreshed by login, logout and `vcloud tools --refresh`. The cached `server/discover` result is kept for the same hour even though the gateway reports a `ttlMs` of 0. A stale catalog is still used to run a command, so a destructive call is refused without touching the network; the cache is refreshed after the call succeeds. When the gateway answers a tool call with JSON-RPC error -32601 or -32602, `vcloud` discards the cached catalog and suggests `vcloud tools --refresh`. When you are not logged in and nothing is cached, `vcloud --help` shows only the built-in commands and says to run `vcloud auth login`.

Tools that cannot become commands are reported by `vcloud tools` (a `vcloud: note:` line per tool on stderr, an `unmapped` array with reasons in `--json`): a name that collides with another command, or a namespace that collides with `auth` or `tools`. A property whose flag would collide with a global option (`json`, `env`, `yes`, `input`, `help`, `version`, `interactive`, `dry-run`) or with another property has no flag; the command's `--help` names such properties as accepted only through `--input`. `null` is accepted only for nullable properties, and JSON-valued flags must match the declared object or array shape.

`--dry-run` (every tool command) prints `{"tool":...,"arguments":{...}}` on stdout without calling the tool and needs no `--yes`.

### Destructive tools

A tool is destructive unless it declares `readOnlyHint: true` or `destructiveHint: false`. `--yes` proceeds. Without it, `vcloud` asks `[y/N]` on stderr only when stdin is a terminal and neither `--no-interactive` nor `CI` is set. Otherwise it refuses with exit code 2 before contacting the gateway, and the message names the reason: no terminal, `CI` set, `--no-interactive`, or `--input -` taking its input from standard input. End of input or an answer other than `y` at the prompt aborts with `vcloud: aborted` and exit code 1; Ctrl-C exits with 130.

## Output

Results go to stdout; diagnostics, prompts and hints go to stderr. Nothing is colored.

- `--json` (every tool command, `vcloud tools`, `vcloud auth status`) prints the tool's `structuredContent`, falling back to its text parsed as JSON. It is pretty-printed on a terminal and compact when piped.
- The default human format is TSV. A result with a single array-of-objects field becomes a table with an uppercase header row; nested objects are flattened to dot paths and arrays are JSON in the cell. Any other object prints `key<TAB>value` per scalar, with multi-line strings printed as blocks after the scalars. A text-only result prints the text.
- A tool error prints `vcloud: <code>: <message>` on stderr (or the raw text when it is not JSON). With `--json`, stderr gets `{"error":{"code","message"}}`, including for usage errors found while parsing the command line. A JSON-RPC protocol error keeps its number in the message and, with `--json`, in `rpc_code` next to `"code":"protocol_error"`. A gateway that cannot be reached is reported as `vcloud: cannot reach <url> (<cause>)`.

## Exit codes

| Code | Meaning                                                                |
| ---- | ---------------------------------------------------------------------- |
| 0    | Success                                                                |
| 1    | Tool or runtime error (the tool reported an error, network failure)    |
| 2    | Usage error (bad flags or arguments, destructive call without `--yes`) |
| 3    | Authentication required or failed                                      |

## Environment variables

| Variable     | Effect                                                             |
| ------------ | ------------------------------------------------------------------ |
| `VC_TOKEN`   | Bearer token used instead of stored credentials; never refreshed   |
| `VC_MCP_URL` | Point vcloud at a different MCP gateway (development, self-hosted) |
| `CI`         | When set, destructive commands never prompt; pass `--yes`          |

## Where things live

Paths come from [`env-paths`](https://github.com/sindresorhus/env-paths) without a suffix:

| What                             | macOS                           | Linux               |
| -------------------------------- | ------------------------------- | ------------------- |
| Credentials (`credentials.json`) | `~/Library/Preferences/vcloud/` | `~/.config/vcloud/` |
| Tool catalog cache               | `~/Library/Caches/vcloud/`      | `~/.cache/vcloud/`  |

`credentials.json` is keyed by gateway URL, written atomically, with mode 0600 inside a 0700 directory. Access and refresh tokens are printed only by `vcloud auth token`; tool results are never written to disk.

## Development

```bash
pnpm install
pnpm run knip && pnpm run format:check && pnpm run typecheck && pnpm run lint && pnpm run fta && pnpm run build && pnpm test
pnpm vcloud nodeapi --help    # rebuild, then run from source
```

`pnpm test` includes an integration test that builds the CLI and runs it as a child process against a local stateless MCP server (`test/stub-mcp-server.ts`, built on `@modelcontextprotocol/server`).
