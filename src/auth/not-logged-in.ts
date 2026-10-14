import { loginHint } from "#core/auth-hint";
import { CliFailureError, createFailure } from "#core/cli-failure";
import type { ResolvedGateway } from "#core/resolve-gateway";

export function notLoggedIn(gateway: ResolvedGateway): CliFailureError {
  return new CliFailureError(createFailure("auth", `not logged in to ${gateway.url}`, loginHint()));
}
