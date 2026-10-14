import { describe, expect, it } from "vitest";
import { derivePrincipal } from "./principal.ts";

describe("derivePrincipal", () => {
  it("uses the subject claim when the token has one", () => {
    // Payload {"sub":"user-1"}
    expect(derivePrincipal("h.eyJzdWIiOiJ1c2VyLTEifQ.s")).toBe("user-1");
  });

  it("hashes a token without a subject", () => {
    expect(derivePrincipal("opaque-token")).toBe(
      "sha256:84d3f23da9b5f51b3269566eff05d3fb23607eeef89567f9cd280b90ca0dbc5c",
    );
  });

  it("keys different opaque tokens differently", () => {
    expect(derivePrincipal("another-token")).toBe(
      "sha256:9e78bcb94091b75109fd6773524fc8d6a4f8a6dfb3dae39a9c26c5001879bcf3",
    );
  });

  it("uses anonymous without a token", () => {
    expect(derivePrincipal(undefined)).toBe("anonymous");
  });
});
