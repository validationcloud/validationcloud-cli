# valcloud

`valcloud` is the command-line client for Validation Cloud. Use it to manage Node API endpoints, check usage and ask Mavrik questions from your terminal or from scripts.

```console
$ valcloud nodeapi list-chains
$ valcloud nodeapi get-endpoint 00000000-0000-0000-0000-000000000000 --json
```

## Install

Requires Node.js 22.12 or newer.

```bash
npm install -g @validationcloud/cli
```

To try it without installing, run `npx @validationcloud/cli --help`.

## Log in

```bash
valcloud auth login     # opens your browser
valcloud auth status    # shows whether you are logged in and when the session expires
valcloud auth logout
```

`valcloud auth login --no-browser` prints the sign-in URL instead of opening it. Sessions renew automatically; when that fails, `valcloud` asks you to log in again.

In scripts, you can set `VC_TOKEN` to an access token instead of logging in. `valcloud auth token` prints yours.

## Commands

Once you are logged in, `valcloud --help` lists the commands, and `--help` on any command describes its options:

```bash
valcloud nodeapi --help
valcloud nodeapi create-endpoint --help
```

When a command needs a single value, you can pass it without its flag: `valcloud nodeapi get-endpoint <id>` is the same as `--id <id>`. `--input '<json>'` passes all options as one JSON object, and `--input -` reads that object from stdin. `--dry-run` prints the request instead of sending it.

`valcloud tools` lists every command and marks which ones are read-only and which are destructive.

### Destructive commands

Destructive commands ask for confirmation in a terminal. `--yes` skips the question. Without a terminal, in CI or with `--no-interactive`, they refuse to run unless you pass `--yes`.

## Output

Results print as tab-separated text, ready for `cut`, `awk` or `sort`; lists get a header row. Add `--json` to get JSON instead. Errors and prompts go to stderr, so a pipe only receives results.

| Exit code | Meaning                                                       |
| --------- | ------------------------------------------------------------- |
| 0         | Success                                                       |
| 1         | The command failed (an error from the service, network error) |
| 2         | Usage error, including a destructive command without `--yes`  |
| 3         | Not logged in, or the login failed                            |

Credentials are stored in `~/Library/Preferences/valcloud/` on macOS and `~/.config/valcloud/` on Linux, readable only by you.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

The code is released under the [MIT License](LICENSE). The Validation Cloud name and logo are trademarks of Validation Cloud and are not covered by that license.
