import { describe, expect, it } from "vitest";
import { authHint, loginHint } from "./auth-hint.ts";

describe("authHint", () => {
  it("points at the login command for stored credentials", () => {
    expect(authHint({ usesStaticToken: false })).toBe("run 'valcloud auth login'");
  });

  it("points at VC_TOKEN when a static token is in use", () => {
    expect(authHint({ usesStaticToken: true })).toBe(
      "fix or unset VC_TOKEN (stored credentials are used when it is unset)",
    );
  });
});

describe("loginHint", () => {
  it("names the login command", () => {
    expect(loginHint()).toBe("run 'valcloud auth login'");
  });
});
