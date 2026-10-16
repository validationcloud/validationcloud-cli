import { Command } from "@commander-js/extra-typings";
import { createFailure, formatFailure } from "#core/cli-failure";
import { buildToolSpecs } from "#core/build-tool-specs";
import { renderExitCodeHelp } from "#core/exit-codes";
import type { LoadedCatalog } from "#mcp/load-catalog";
import { addAuthCommands } from "./add-auth-commands.ts";
import { addToolCommands } from "./add-tool-commands.ts";
import { BUILT_IN_COMMANDS, addToolsCommand } from "./add-tools-command.ts";
import type { CliContext } from "./cli-context.ts";
import { packageInfo } from "#shared/package-info";

export type CatalogAvailability =
  | { kind: "loaded"; catalog: LoadedCatalog }
  | { kind: "unavailable"; note: string };

const ROOT_HELP_FOOTER = `
Tool commands come from the gateway's tool list, so 'valcloud <namespace> --help'
shows what your account can call. Run 'valcloud tools' for the full list.

Examples:
  valcloud auth login
  valcloud tools
  valcloud <namespace> --help
  valcloud <namespace> <command> --help
  valcloud <namespace> <command> --json
  valcloud tools | tail -n +2 | cut -f1 | sort | uniq -c

Environment variables:
  VC_TOKEN    Bearer token to use instead of stored credentials; never refreshed
  VC_MCP_URL  Point valcloud at a different MCP gateway (development, self-hosted)
  VC_REQUEST_TIMEOUT_MS
              Milliseconds to wait for each gateway request (default 60000, 330000 for a tool call)
  CI          When set, destructive commands never prompt; pass --yes`;

const USAGE_ERROR_HINT = "(add --help for additional information)";

const EXIT_CODE_FOOTER = `
Exit codes:
${renderExitCodeHelp()}`;

export function buildProgram(context: CliContext, availability: CatalogAvailability): Command {
  const program = new Command("valcloud")
    .description(packageInfo.description)
    .version(packageInfo.version, "-V, --version", "Print the version")
    .helpCommand(false)
    .showSuggestionAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: context.stdout,
      writeErr: context.stderr,
      outputError: (message, write) => {
        const text = message.replace(/^error: /u, "").trimEnd();
        write(
          context.wantsJson
            ? formatFailure(createFailure("usage", text), true)
            : `valcloud: ${text}\n${USAGE_ERROR_HINT}\n`,
        );
      },
    })
    .addHelpText("after", ROOT_HELP_FOOTER)
    .addHelpText("afterAll", EXIT_CODE_FOOTER);

  addAuthCommands(program, context);
  addToolsCommand(program, context);

  if (availability.kind === "loaded") {
    const { specs } = buildToolSpecs(availability.catalog.tools, BUILT_IN_COMMANDS);
    addToolCommands(program, specs, context, availability.catalog);
  } else {
    program.addHelpText("after", `\n${availability.note}`);
  }
  return program;
}
