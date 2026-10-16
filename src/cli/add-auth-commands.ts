import type { Command } from "@commander-js/extra-typings";
import { runLogin } from "#auth/login";
import { notLoggedIn } from "#auth/not-logged-in";
import { resolveCredentials } from "#auth/resolve-credentials";
import { CredentialsFileError } from "#auth/credentials-file-error";
import { decodeJwtClaims } from "#core/decode-jwt-claims";
import { describeAuthStatus } from "#core/describe-auth-status";
import { exitCodeFor } from "#core/exit-codes";
import { formatHuman, formatJson } from "#core/format-output";
import { SilentExitError } from "#core/silent-exit-error";
import { loadCatalog } from "#mcp/load-catalog";
import { buildCatalogRequest } from "./build-catalog-request.ts";
import type { CliContext } from "./cli-context.ts";
import { credentialsForConnect } from "./credentials-for-connect.ts";

async function login(context: CliContext, launchBrowser: boolean): Promise<void> {
  const { gateway, credentialStore } = context;
  if (context.usesStaticToken) {
    context.stderr(
      "valcloud: note: VC_TOKEN is set and takes precedence over stored credentials\n",
    );
  }
  await runLogin({
    gateway,
    store: credentialStore,
    launchBrowser,
    requestTimeoutMs: context.requestTimeouts.setupMs,
    tell: context.stderr,
  });

  const credentials = await resolveCredentials(gateway, undefined, credentialStore);
  await loadCatalog(
    buildCatalogRequest(context, {
      credentials,
      policy: "refresh",
      connectionCredentials: () => Promise.resolve(credentials),
    }),
  );
  const subject =
    credentials.source === "none" ? undefined : decodeJwtClaims(credentials.accessToken).sub;
  context.stderr(`Logged in to ${gateway.url}${subject === undefined ? "" : ` as ${subject}`}.\n`);
}

async function logout(context: CliContext): Promise<void> {
  const { credentialStore, catalogStore, gateway } = context;
  try {
    await credentialStore.remove(gateway.url);
  } catch (error) {
    if (!(error instanceof CredentialsFileError)) throw error;
    // Logout is the recovery path for a corrupt file: remove it, since nothing in it can be kept.
    if (await credentialStore.discardUnreadable()) {
      context.stderr(`valcloud: removed the unreadable credentials file (${error.filePath})\n`);
    }
  }
  await catalogStore.remove(gateway.url);
}

async function status(context: CliContext, json: boolean): Promise<void> {
  const { gateway } = context;
  const credentials = await context.credentials();
  const authStatus = describeAuthStatus({
    gateway,
    source: credentials.source,
    timing:
      credentials.source === "none"
        ? undefined
        : {
            accessToken: credentials.accessToken,
            savedAtMs:
              credentials.source === "stored" ? credentials.entry.tokensSavedAtMs : undefined,
            expiresInSeconds:
              credentials.source === "stored" ? credentials.entry.tokens?.expires_in : undefined,
          },
    refreshable:
      credentials.source === "stored" && credentials.entry.tokens?.refresh_token !== undefined,
    nowMs: Date.now(),
  });
  context.stdout(json ? formatJson(authStatus, process.stdout.isTTY) : formatHuman(authStatus));
  if (!json && authStatus.logged_in && !authStatus.verified) {
    context.stderr("valcloud: note: token not verified locally (no readable expiry)\n");
  }
  if (!authStatus.logged_in) throw new SilentExitError(exitCodeFor("auth"));
}

async function printToken(context: CliContext): Promise<void> {
  const credentials = await credentialsForConnect(context);
  if (credentials.source === "none") throw notLoggedIn(context.gateway);
  context.stdout(`${credentials.accessToken}\n`);
}

export function addAuthCommands(program: Command, context: CliContext): void {
  const authCommand = program
    .command("auth")
    .helpCommand(false)
    .description("Sign in to Validation Cloud and manage stored credentials");

  authCommand
    .command("login")
    .description("Sign in through the browser (OAuth authorization code with PKCE)")
    .option("--no-browser", "Print the sign-in URL instead of opening a browser")
    .action(async (options) => {
      await login(context, options.browser);
    });

  authCommand
    .command("logout")
    .description("Delete the stored credentials and cached tool catalog for this gateway")
    .action(async () => {
      await logout(context);
    });

  authCommand
    .command("status")
    .description("Show whether you are logged in (exits 3 when not); prints no secrets")
    .option("--json", "Print the status as JSON")
    .action(async (options) => {
      await status(context, options.json === true);
    });

  authCommand
    .command("token")
    .description("Print the current access token, refreshing it first if it has expired")
    .action(async () => {
      await printToken(context);
    });
}
