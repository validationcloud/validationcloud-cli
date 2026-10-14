import { describe, expect, it } from "vitest";
import { parseCallbackOutcome } from "./parse-callback-outcome.ts";

describe("parseCallbackOutcome", () => {
  it("reports success when the callback carries a code", () => {
    expect(parseCallbackOutcome(new URLSearchParams("code=x&state=s"))).toStrictEqual({
      kind: "success",
    });
  });

  it("reports failure with the error and its description", () => {
    expect(
      parseCallbackOutcome(
        new URLSearchParams("error=access_denied&error_description=The+user+denied+the+request"),
      ),
    ).toStrictEqual({
      kind: "failure",
      error: "access_denied",
      errorDescription: "The user denied the request",
    });
  });

  it("reports failure without a description when none is given", () => {
    expect(parseCallbackOutcome(new URLSearchParams("error=server_error"))).toStrictEqual({
      kind: "failure",
      error: "server_error",
      errorDescription: undefined,
    });
  });

  it("reports failure when the callback carries neither a code nor an error", () => {
    expect(parseCallbackOutcome(new URLSearchParams("state=s"))).toStrictEqual({
      kind: "failure",
      error: "missing_code",
      errorDescription: "The callback carried no authorization code.",
    });
  });
});
