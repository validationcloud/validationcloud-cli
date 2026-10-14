import { CliFailureError } from "#core/cli-failure";
import type { CliFailure } from "#core/cli-failure";
import { mapErrorFacts } from "#core/map-error";
import type { ErrorMappingContext } from "#core/map-error";
import { classifyError } from "./classify-error.ts";

export function toFailure(error: unknown, context: ErrorMappingContext): CliFailure {
  if (error instanceof CliFailureError) return error.failure;
  return mapErrorFacts(classifyError(error), context);
}
