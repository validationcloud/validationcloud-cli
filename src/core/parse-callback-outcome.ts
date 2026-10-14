import type { CallbackOutcome } from "./render-callback-page.ts";

export function parseCallbackOutcome(params: URLSearchParams): CallbackOutcome {
  const error = params.get("error");
  if (error !== null) {
    return {
      kind: "failure",
      error,
      errorDescription: params.get("error_description") ?? undefined,
    };
  }
  if (params.get("code") === null) {
    return {
      kind: "failure",
      error: "missing_code",
      errorDescription: "The callback carried no authorization code.",
    };
  }
  return { kind: "success" };
}
