# Contributing

## Development

Development needs the Node.js version in `.node-version`; the complexity check (`fta`) needs Node 24.15 or newer.

```bash
pnpm install
pnpm run knip && pnpm run format:check && pnpm run typecheck && pnpm run lint && pnpm run fta && pnpm run build && pnpm test
pnpm valcloud nodeapi --help    # rebuild, then run from source
```

`pnpm test` includes an integration test that builds the CLI and runs it as a child process against a local stateless MCP server (`test/stub-mcp-server.ts`, built on `@modelcontextprotocol/server`).

`VC_MCP_URL` points `valcloud` at a different MCP gateway for one run. It must be https, or http on localhost.

## Releasing

Merging into `main` publishes to npm through the `Release` workflow after CI passes. semantic-release picks the version from the squash commit, whose title and body are the pull request's:

| Commit                                                         | Release |
| -------------------------------------------------------------- | ------- |
| `fix:` or `perf:`                                              | patch   |
| `feat:`                                                        | minor   |
| a `BREAKING CHANGE:` line in the body                          | major   |
| anything else (`chore:`, `docs:`, `test:`, `refactor:`, `ci:`) | none    |

semantic-release's default preset does not recognize the `!` shorthand (`feat!:`): such a title releases nothing.

The workflow tags the commit before it publishes, so if `npm publish` fails, delete the new tag and its GitHub release before re-running it.
