import type { Option } from "@commander-js/extra-typings";
import { ProtocolError } from "@modelcontextprotocol/client";
import type { Client } from "@modelcontextprotocol/client";
import { buildMcpAuth } from "#auth/resolve-credentials";
import type { Credentials } from "#auth/resolve-credentials";
import type { PropertySpec, ToolSpec } from "#core/build-tool-spec";
import { CliFailureError, createFailure, failureFromTool } from "#core/cli-failure";
import { coerceFlagValue } from "#core/coerce-flag-value";
import { decideConfirmation, describeRefusal, isCiEnvironment } from "#core/decide-confirmation";
import type { ConfirmationDecision } from "#core/decide-confirmation";
import { formatJson } from "#core/format-output";
import { interpretToolResult } from "#core/interpret-tool-result";
import { isStaleCatalogRpcCode } from "#core/map-error";
import { renderOutcome } from "#core/render-outcome";
import { resolveToolArguments } from "#core/resolve-tool-arguments";
import { SilentExitError } from "#core/silent-exit-error";
import { connectMcpClient } from "#mcp/connect-mcp-client";
import { refreshCatalogFrom } from "#mcp/load-catalog";
import type { LoadedCatalog } from "#mcp/load-catalog";
import { principalOfCredentials } from "./build-catalog-request.ts";
import type { CliContext } from "./cli-context.ts";
import { confirmOnStderr } from "./confirm-on-stderr.ts";
import { credentialsForConnect } from "./credentials-for-connect.ts";
import { readStdin } from "./read-stdin.ts";
import { toFailure } from "./to-failure.ts";

const SIGINT_EXIT_CODE = 130;

export type FlagBinding = { property: PropertySpec; option: Option };

export type ToolInvocation = {
  spec: ToolSpec;
  bindings: readonly FlagBinding[];
  options: Readonly<Record<string, unknown>>;
  positionalRaw: string | undefined;
  catalog: LoadedCatalog;
  context: CliContext;
};

function usageFailure(spec: ToolSpec, message: string): CliFailureError {
  return new CliFailureError(
    createFailure(
      "usage",
      message,
      `run 'valcloud ${spec.namespace} ${spec.command} --help' for usage`,
    ),
  );
}

function collectFlagValues(invocation: ToolInvocation): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const { property, option } of invocation.bindings) {
    const value = invocation.options[option.attributeName()];
    if (value !== undefined) values[property.key] = value;
  }
  return values;
}

function parsePositional(invocation: ToolInvocation): unknown {
  const { spec, positionalRaw } = invocation;
  if (positionalRaw === undefined || spec.positional === undefined) return undefined;
  const coerced = coerceFlagValue(spec.positional, positionalRaw);
  if (!coerced.ok) throw usageFailure(spec, `<${spec.positional.flag}>: ${coerced.error}`);
  return coerced.value;
}

async function readInputOption(input: unknown): Promise<string | undefined> {
  if (typeof input !== "string") return undefined;
  return input === "-" ? readStdin() : input;
}

function decideFor(invocation: ToolInvocation): ConfirmationDecision {
  const { spec, options, context } = invocation;
  return decideConfirmation({
    destructive: spec.destructive,
    yes: options.yes === true,
    dryRun: options.dryRun === true,
    noInteractive: options.interactive === false,
    ci: isCiEnvironment(context.processEnv.CI),
    stdinConsumed: options.input === "-",
    stdinIsTty: process.stdin.isTTY,
  });
}

function refuseUnconfirmable(invocation: ToolInvocation, decision: ConfirmationDecision): void {
  if (decision.kind !== "refuse") return;
  const { spec } = invocation;
  throw new CliFailureError(
    createFailure(
      "usage",
      `${spec.toolName} is destructive and cannot be confirmed: ${describeRefusal(decision.reason)}`,
      `pass --yes to proceed with 'valcloud ${spec.namespace} ${spec.command}', or --dry-run to preview`,
    ),
  );
}

async function promptForConfirmation(
  invocation: ToolInvocation,
  decision: ConfirmationDecision,
): Promise<void> {
  if (decision.kind !== "prompt") return;
  const { spec } = invocation;
  const answer = await confirmOnStderr(
    `valcloud ${spec.namespace} ${spec.command} is destructive. Continue?`,
  );
  if (answer === "interrupted") throw new SilentExitError(SIGINT_EXIT_CODE);
  if (answer === "no") throw new CliFailureError(createFailure("runtime", "aborted"));
}

async function refreshStaleCatalog(
  client: Client,
  invocation: ToolInvocation,
  credentials: Credentials,
): Promise<void> {
  const { context, options } = invocation;
  try {
    await refreshCatalogFrom(client, {
      gatewayUrl: context.gateway.url,
      principal: principalOfCredentials(credentials),
      catalogStore: context.catalogStore,
    });
  } catch (error) {
    // The call already succeeded, so a failed cache refresh is a note on stderr rather than a failure.
    if (options.json === true) return;
    const { message } = toFailure(error, context.failureContext);
    context.stderr(`valcloud: note: could not refresh the cached tool list (${message})\n`);
  }
}

export async function runToolCommand(invocation: ToolInvocation): Promise<void> {
  const { spec, options, context, catalog } = invocation;
  const decision = decideFor(invocation);
  // A refusal comes before reading stdin, so `--input -` never waits for input that cannot be confirmed.
  refuseUnconfirmable(invocation, decision);
  const resolved = resolveToolArguments(spec, {
    inputJson: await readInputOption(options.input),
    flagValues: collectFlagValues(invocation),
    positionalValue: parsePositional(invocation),
  });
  if (!resolved.ok) throw usageFailure(spec, resolved.error);

  const pretty = process.stdout.isTTY;
  if (options.dryRun === true) {
    context.stdout(formatJson({ tool: spec.toolName, arguments: resolved.value }, pretty));
    return;
  }
  await promptForConfirmation(invocation, decision);

  const { gateway } = context;
  const credentials = await credentialsForConnect(context);
  const auth = buildMcpAuth(credentials, gateway, context.credentialStore);
  const { client } = await connectMcpClient(gateway.url, auth, catalog.discover);
  let result;
  try {
    try {
      result = await client.callTool({ name: spec.toolName, arguments: resolved.value });
    } catch (error) {
      if (error instanceof ProtocolError && isStaleCatalogRpcCode(error.code)) {
        await context.catalogStore.remove(gateway.url);
      }
      throw error;
    }
    if (catalog.stale) await refreshStaleCatalog(client, invocation, credentials);
  } finally {
    await client.close();
  }

  const outcome = interpretToolResult(result);
  if (outcome.kind === "failure") {
    throw new CliFailureError(failureFromTool(outcome.failure, context.failureContext));
  }
  const text = renderOutcome(outcome, { json: options.json === true, pretty });
  if (text !== "") context.stdout(text);
}
