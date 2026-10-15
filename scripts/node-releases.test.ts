import { describe, expect, it } from "vitest";
import { latestInMajor, parseShasums, trustedSigner } from "./node-releases.ts";

const hash = (digit: string) => digit.repeat(64);

describe("parseShasums", () => {
  it("picks the tarball hash of each platform", () => {
    const shasums = [
      `${hash("1")}  node-v24.9.0-darwin-arm64.tar.gz`,
      `${hash("0")}  node-v24.9.0-darwin-arm64.tar.xz`,
      `${hash("2")}  node-v24.9.0-darwin-x64.tar.gz`,
      `${hash("3")}  node-v24.9.0-linux-x64.tar.gz`,
      `${hash("4")}  node-v24.9.0-linux-arm64.tar.gz`,
      `${hash("5")}  node-v24.9.0-linux-x64-musl.tar.gz`,
      "",
    ].join("\n");

    expect(parseShasums(shasums, "24.9.0")).toStrictEqual({
      "darwin-arm64": hash("1"),
      "darwin-x64": hash("2"),
      "linux-x64": hash("3"),
      "linux-arm64": hash("4"),
      "linux-x64-musl": hash("5"),
    });
  });

  it("fails when a platform is missing", () => {
    const shasums = `${hash("1")}  node-v24.9.0-darwin-arm64.tar.gz\n`;

    expect(() => parseShasums(shasums, "24.9.0")).toThrow(
      "SHASUMS256.txt has no valid SHA-256 for node-v24.9.0-darwin-x64.tar.gz",
    );
  });
});

describe("latestInMajor", () => {
  it("compares versions numerically within the major", () => {
    const index = [
      { version: "v25.1.0" },
      { version: "v24.9.0" },
      { version: "v24.22.1" },
      { version: "v24.22.0" },
      { version: "v22.30.0" },
    ];

    expect(latestInMajor(index, 24)).toBe("24.22.1");
  });

  it("fails when the major has no release", () => {
    expect(() => latestInMajor([{ version: "v22.30.0" }], 24)).toThrow(
      "nodejs.org lists no Node.js 24.x release",
    );
  });
});

describe("trustedSigner", () => {
  const richard = "C82FA3AE1CBEDC6BE46B9360C43CEC45C17AB93C";
  const good = [
    "[GNUPG:] GOODSIG C43CEC45C17AB93C Richard Lau <richard.lau@ibm.com>",
    `[GNUPG:] VALIDSIG AAAA 2026-10-14 1792854638 0 4 0 1 10 01 ${richard}`,
  ].join("\n");

  it("returns the primary key of a good signature by a trusted key", () => {
    expect(trustedSigner(good, [richard])).toBe(richard);
  });

  it("rejects a good signature by a key that is not on the trusted list", () => {
    expect(() => trustedSigner(good, ["5BE8A3F6C8A5C01D106C0AD820B1A390B168D356"])).toThrow(
      `signed by ${richard}, which is not in scripts/node-release-keys.json`,
    );
  });

  it.each(["REVKEYSIG", "EXPKEYSIG", "KEYREVOKED", "ERRSIG", "BADSIG"])(
    "rejects %s even next to a valid-looking signer line",
    (status) => {
      expect(() =>
        trustedSigner(`[GNUPG:] ${status} C43CEC45C17AB93C Richard Lau\n${good}`, [richard]),
      ).toThrow(`gpg reported ${status}`);
    },
  );

  it("rejects output without a good signature", () => {
    expect(() => trustedSigner("", [richard])).toThrow("did not report a good signature");
  });
});
