import type { Command } from "@commander-js/extra-typings";
import type { ToolSpec } from "#core/build-tool-spec";
import { buildToolSpecs } from "#core/build-tool-specs";
import { formatJson } from "#core/format-output";
import { formatToolList } from "#core/format-tool-list";
import { loadCatalog } from "#mcp/load-catalog";
import { buildCatalogRequest } from "./build-catalog-request.ts";
import type { CliContext } from "./cli-context.ts";
import { credentialsForConnect } from "./credentials-for-connect.ts";

export const BUILT_IN_COMMANDS: ReadonlySet<string> = new Set(["auth", "tools"]);

function toRow(spec: ToolSpec): Record<string, unknown> {
  return {
    namespace: spec.namespace,
    command: spec.command,
    tool: spec.toolName,
    description: spec.description,
    read_only: spec.readOnly,
    destructive: spec.destructive,
  };
}

export function addToolsCommand(program: Command, context: CliContext): void {
  program
    .command("tools")
    .description("List the tool commands the gateway offers")
    .option("--json", "Print the list as JSON")
    .option("--refresh", "Fetch the catalog again instead of using the cache")
    .action(async (options) => {
      const catalog = await loadCatalog(
        buildCatalogRequest(context, {
          credentials: await context.credentials(),
          policy: options.refresh === true ? "refresh" : "prefer-fresh",
          connectionCredentials: () => credentialsForConnect(context),
        }),
      );
      const { specs, unmapped } = buildToolSpecs(catalog.tools, BUILT_IN_COMMANDS);
      if (options.json === true) {
        const tools = specs.map((spec) =>
          Object.assign(toRow(spec), { input_only_properties: spec.inputOnlyProperties }),
        );
        context.stdout(
          formatJson(
            {
              tools,
              unmapped: unmapped.map(({ toolName, reason }) => ({ tool: toolName, reason })),
            },
            process.stdout.isTTY,
          ),
        );
        return;
      }
      context.stdout(formatToolList(specs));
      for (const { toolName, reason } of unmapped) {
        context.stderr(`valcloud: note: ${toolName} has no command: ${reason}\n`);
      }
    });
}
