# Contributing

## Development

Development needs the Node.js version in `.node-version`; the complexity check (`fta`) needs Node 24.15 or newer.

```bash
pnpm install
pnpm run knip && pnpm run format:check && pnpm run typecheck && pnpm run lint && pnpm run fta && pnpm run build && pnpm test
pnpm valcloud nodeapi --help    # rebuild, then run from source
```

`pnpm test` includes an integration test that builds the CLI and runs it as a child process against a local stateless MCP server (`test/stub-mcp-server.ts`, built on `@modelcontextprotocol/server`).

Four more commands cover the installer (see [docs/install-script.md](docs/install-script.md)):

```bash
pnpm run test:bundle              # the same integration test against release/valcloud.mjs; needs the Node.js version in scripts/node-runtime.json
pnpm run test:installer           # builds the release assets, then runs the installer scenarios on this machine under /bin/bash
pnpm run test:installer:docker    # clean Linux containers: glibc, musl, too-old glibc, missing tools (needs docker)
pnpm run lint:shell               # shellcheck on the installer and its tests
```

`pnpm run build:release` writes `release/valcloud.mjs`, `release/install.sh` and `release/SHA256SUMS`. The first run of the installer tests downloads the pinned Node.js tarballs (about 55 MB each) into a cache under `$TMPDIR`; set `VALCLOUD_TEST_NODE_CACHE` to keep them elsewhere. The tests only ever use isolated `HOME` directories and never contact Validation Cloud.

`VC_MCP_URL` points `valcloud` at a different MCP gateway for one run. It must be https, or http on localhost.

`VC_REQUEST_TIMEOUT_MS` replaces the request limits (60 s to load the tool list or sign in, 330 s for a tool call, 20 s per step of a token refresh) with one value; the integration tests shorten it to exercise a proxy that closes the connection or never answers.

## Releasing

Merging into `main` publishes to npm and to GitHub Releases through the `Release` workflow after CI passes. semantic-release picks the version from the squash commit, whose title and body are the pull request's:

| Commit                                                         | Release |
| -------------------------------------------------------------- | ------- |
| `fix:` or `perf:`                                              | patch   |
| `feat:`                                                        | minor   |
| a `BREAKING CHANGE:` line in the body                          | major   |
| anything else (`chore:`, `docs:`, `test:`, `refactor:`, `ci:`) | none    |

semantic-release's default preset does not recognize the `!` shorthand (`feat!:`): such a title releases nothing.

The installer ships its own copy of Node.js and every dependency of the CLI, so npm's caret ranges no longer deliver their fixes to installer users. A Node.js bump and a production dependency update must therefore release: title them `fix(runtime): …` and `fix(deps): …`. A `chore(deps):` title releases nothing, so customers would never get the fix.

The workflow tags the commit before it publishes, so if `npm publish` fails, delete the new tag and its GitHub release before re-running it.

### What a release contains

The release job runs `scripts/build-release.ts` between the npm step and the GitHub step (`release.config.js`; the order matters, because the version npm writes into `package.json` is inlined into the bundle). The GitHub release carries three assets:

- `valcloud.mjs`, an esbuild bundle of `dist/cli.js` with every dependency inlined, ending with the license texts of everything it bundles (generated from esbuild's metafile and each package's `LICENSE` file; the build fails for a bundled package without one).
- `install.sh`, rendered from `scripts/install.sh.in` with this release's version, the bundle URL and SHA-256, and the pinned Node.js hashes from `scripts/node-runtime.json`.
- `SHA256SUMS`, for people who want to check by hand.

The build fails unless all three exist, because `@semantic-release/github` publishes a release without an asset it cannot read. After the release, the `smoke-install` job installs in a clean Debian container twice and compares `valcloud --version` with the released version each time: from the pinned `releases/download/v<version>/install.sh`, and from `releases/latest/download/install.sh`, which is what the one-liner behind `validationcloud.io/install.sh` fetches. The second step waits (up to about 10 minutes, with backoff) for `latest` to serve the new version before it installs. A red job means customers cannot install: npm already has the version, and semantic-release will not retry a tag that exists, so fix it by hand. The repository cannot page anyone itself; enable failure notifications for the `Release` workflow so that someone is told.

The release job runs on the pinned Node.js version, so the bundle smoke test in `build-release.ts` uses the runtime customers get, and it sets `pnpm_config_verify_deps_before_run=false` for semantic-release: when `@semantic-release/npm` rewrites the version in `package.json`, pnpm 11 would otherwise re-run the install, with lifecycle scripts, before the next `pnpm run`.

### Bumping Node.js

`pnpm run bump-node [version]` pins the newest release of the current major (or the version you give) in `scripts/node-runtime.json`. It downloads `SHASUMS256.txt.asc` and verifies it with `gpg` against the keys committed in `scripts/node-release-keys.json`, the eight active releasers listed in the Release keys section of [nodejs/node's README](https://github.com/nodejs/node/blob/main/README.md). The key material comes from [nodejs/release-keys](https://github.com/nodejs/release-keys), but only for those fingerprints, so a retired key there is never trusted. A good signature by any other key, and any revoked, expired or unverifiable one, fails the bump. If a releaser joins, the bump fails until you update the JSON file by hand from that README; when one leaves, remove their key from the file too, because a key that was not revoked stays trusted until you do. The script writes the five tarball hashes and prints the commit title to use. Before opening the pull request, check by hand that the macOS floor (`13.5`, in `check_macos_version`) still equals the `minos` that `vtool -show-build` reports for both darwin binaries and that the glibc floor (`2.28`, in `detect_linux_libc`) still equals the highest `GLIBC_` symbol of the Linux binaries. Node.js 24 reaches end of life in April 2028; bump to a newer major before then.

### Proxy and certificate flags

The launcher starts Node.js as `node --use-env-proxy --use-system-ca <bundle>`: the first makes `fetch` honour `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY`, the second trusts the operating system's certificate store, which TLS-inspecting corporate proxies need. Without a proxy the first changes nothing, and the second only widens the trusted certificates to the system store. They are flags, not `NODE_USE_ENV_PROXY`, so they apply to the installer's own runtime and nothing else on the machine. `test/installer/run.sh` checks the flags and a plain CONNECT proxy with `NO_PROXY`. On every Node.js pin bump, also run `valcloud` through a real squid, a tinyproxy and a mitmproxy (once with its CA in the OS store, once with the CA only in `NODE_EXTRA_CA_CERTS`) and make sure requests go through and nothing hangs.

Known risk, contained: on undici 7 (Node.js 24), a proxy that closes the connection to a `CONNECT` request without replying makes `fetch` reconnect forever ([nodejs/undici#3897](https://github.com/nodejs/undici/issues/3897), fixed in undici 8.6.0). `valcloud` still ends: the request timeout fails the call and the explicit exit closes the stuck socket (AGENTS.md, Timeouts and exit). The `bundle` CI job runs the proxy tests against the bundle on the pinned runtime.
