import { InvalidArgumentError, Option } from "@commander-js/extra-typings";
import type { Command } from "@commander-js/extra-typings";
import { describeOption } from "#core/describe-option";
import type { PropertySpec, ToolSpec } from "#core/build-tool-spec";
import { groupByNamespace } from "#core/build-tool-specs";
import { coerceFlagValue } from "#core/coerce-flag-value";
import type { LoadedCatalog } from "#mcp/load-catalog";
import type { CliContext } from "./cli-context.ts";
import { runToolCommand } from "./run-tool-command.ts";
import type { FlagBinding } from "./run-tool-command.ts";

const VALUE_PLACEHOLDERS: Record<PropertySpec["kind"], string> = {
  string: "string",
  integer: "integer",
  number: "number",
  boolean: "boolean",
  enum: "value",
  json: "json",
};

function createFlagOptions(property: PropertySpec): Option[] {
  if (property.flag === undefined) return [];
  if (property.kind === "boolean") {
    return [
      new Option(`--${property.flag}`, describeOption(property)),
      new Option(`--no-${property.flag}`, `Set ${property.key} to false`),
    ];
  }
  const option = new Option(
    `--${property.flag} <${VALUE_PLACEHOLDERS[property.kind]}>`,
    describeOption(property),
  );
  return [
    option.argParser((raw: string) => {
      const coerced = coerceFlagValue(property, raw);
      if (!coerced.ok) throw new InvalidArgumentError(coerced.error);
      return coerced.value;
    }),
  ];
}

function addToolCommand(
  namespaceCommand: Command,
  spec: ToolSpec,
  context: CliContext,
  catalog: LoadedCatalog,
): void {
  const command = namespaceCommand
    .command(spec.command)
    .summary(spec.summary)
    .description(spec.description === "" ? spec.toolName : spec.description);

  const bindings: FlagBinding[] = [];
  for (const property of spec.properties) {
    const [primary, ...rest] = createFlagOptions(property);
    if (primary === undefined) continue;
    bindings.push({ property, option: primary });
    for (const option of [primary, ...rest]) command.addOption(option);
  }
  if (spec.positional?.flag !== undefined) {
    command.argument(
      `[${spec.positional.flag}]`,
      `${spec.positional.key} (same as --${spec.positional.flag})`,
    );
  }
  command
    .option(
      "--input <json|->",
      "Tool arguments as a JSON object, or - to read it from stdin; flags override it",
    )
    .option("--json", "Print the result as JSON")
    .option(
      "--dry-run",
      "Print the tool name and resolved arguments as JSON without calling the tool",
    );
  if (spec.inputOnlyProperties.length > 0) {
    command.addHelpText(
      "after",
      `\nAccepted only through --input: ${spec.inputOnlyProperties.join(", ")}`,
    );
  }
  if (spec.destructive) {
    command
      .option("-y, --yes", "Proceed without confirmation (this tool is destructive)")
      .option("--no-interactive", "Never prompt; refuse unless --yes is given");
  }

  command.action(async () => {
    await runToolCommand({
      spec,
      bindings,
      options: command.opts(),
      positionalRaw: command.args[0],
      catalog,
      context,
    });
  });
}

export function addToolCommands(
  program: Command,
  specs: readonly ToolSpec[],
  context: CliContext,
  catalog: LoadedCatalog,
): void {
  for (const [namespace, group] of groupByNamespace(specs)) {
    const namespaceCommand = program
      .command(namespace)
      .helpCommand(false)
      .description(`Tools in the ${namespace} namespace`);
    for (const spec of group) addToolCommand(namespaceCommand, spec, context, catalog);
  }
}
