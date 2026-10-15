import { CommanderError } from "@commander-js/extra-typings";
import { withSdkConsoleCaptured } from "#auth/capture-sdk-console";
import { createCredentialStore } from "#auth/credential-store";
import { resolveCredentials } from "#auth/resolve-credentials";
import type { Credentials } from "#auth/resolve-credentials";
import { loginHint } from "#core/auth-hint";
import { CliFailureError, createFailure, formatFailure } from "#core/cli-failure";
import type { CliFailure } from "#core/cli-failure";
import { exitCodeFor } from "#core/exit-codes";
import { SilentExitError } from "#core/silent-exit-error";
import { resolveGateway } from "#core/resolve-gateway";
import type { ResolvedGateway } from "#core/resolve-gateway";
import { scanGlobalArgs } from "#core/scan-global-args";
import type { GlobalArgsScan } from "#core/scan-global-args";
import { createCatalogStore } from "#mcp/catalog-store";
import { loadCatalog } from "#mcp/load-catalog";
import { buildCatalogRequest } from "./build-catalog-request.ts";
import { BUILT_IN_COMMANDS } from "./add-tools-command.ts";
import { cacheDirectory, credentialsFilePath } from "./app-paths.ts";
import { credentialsForConnect } from "./credentials-for-connect.ts";
import { buildProgram } from "./build-program.ts";
import type { CatalogAvailability } from "./build-program.ts";
import type { CliContext } from "./cli-context.ts";
import { toFailure } from "./to-failure.ts";

export type CliIo = {
  processEnv: NodeJS.ProcessEnv;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

function createContext(gateway: ResolvedGateway, io: CliIo, wantsJson: boolean): CliContext {
  const credentialStore = createCredentialStore(credentialsFilePath);
  const usesStaticToken = (io.processEnv.VC_TOKEN ?? "") !== "";
  let pendingCredentials: Promise<Credentials> | undefined;
  return {
    gateway,
    processEnv: io.processEnv,
    credentialStore,
    catalogStore: createCatalogStore(cacheDirectory),
    usesStaticToken,
    wantsJson,
    credentials: () => {
      pendingCredentials ??= resolveCredentials(gateway, io.processEnv.VC_TOKEN, credentialStore);
      return pendingCredentials;
    },
    failureContext: {
      usesStaticToken,
      gatewayUrl: gateway.url,
    },
    stdout: io.stdout,
    stderr: io.stderr,
  };
}

function missingCatalogNote(): string {
  return `Tool commands are not loaded yet: ${loginHint()} to load them.`;
}

function unloadedCatalogNote(failure: CliFailure): string {
  const next = failure.hint === undefined ? "" : `; ${failure.hint}`;
  return `Tool commands could not be loaded (${failure.message})${next}.`;
}

async function prepareCatalog(
  scan: GlobalArgsScan,
  context: CliContext,
): Promise<CatalogAvailability> {
  const { gateway } = context;
  const { firstToken } = scan;
  if (firstToken !== undefined && BUILT_IN_COMMANDS.has(firstToken)) {
    return { kind: "unavailable", note: "" };
  }
  if (firstToken === undefined && scan.wantsVersion) return { kind: "unavailable", note: "" };

  try {
    const credentials = await context.credentials();
    if (credentials.source === "none") {
      if (firstToken === undefined) {
        return { kind: "unavailable", note: missingCatalogNote() };
      }
      throw new CliFailureError(
        createFailure(
          "auth",
          `not logged in to ${gateway.url}, so tool commands are unavailable`,
          loginHint(),
        ),
      );
    }
    // A cached catalog is used whatever its age: classifying a destructive call must never need the network.
    const catalog = await loadCatalog(
      buildCatalogRequest(context, {
        credentials,
        policy: "prefer-cached",
        connectionCredentials: () => credentialsForConnect(context),
      }),
    );
    return { kind: "loaded", catalog };
  } catch (error) {
    if (firstToken !== undefined) throw error;
    return {
      kind: "unavailable",
      note: unloadedCatalogNote(toFailure(error, context.failureContext)),
    };
  }
}

export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const scan = scanGlobalArgs(argv);
  const resolved = resolveGateway(io.processEnv.VC_MCP_URL);
  if (!resolved.ok) {
    io.stderr(formatFailure(createFailure("usage", resolved.error), scan.wantsJson));
    return exitCodeFor("usage");
  }
  const context = createContext(resolved.value, io, scan.wantsJson);

  const captured = await withSdkConsoleCaptured(async () => {
    const availability = await prepareCatalog(scan, context);
    const program = buildProgram(context, availability);
    await program.parseAsync([...argv], { from: "user" });
  });
  if (captured.suppressedCount > 0 && !scan.wantsJson) {
    io.stderr(
      `valcloud: note: the MCP SDK printed ${captured.suppressedCount} message(s) that were hidden because they can quote server responses\n`,
    );
  }
  if (captured.status === "fulfilled") return 0;

  const { reason: error } = captured;
  if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : exitCodeFor("usage");
  if (error instanceof SilentExitError) return error.exitCode;
  const failure = toFailure(error, context.failureContext);
  io.stderr(formatFailure(failure, scan.wantsJson));
  return exitCodeFor(failure.kind);
}
