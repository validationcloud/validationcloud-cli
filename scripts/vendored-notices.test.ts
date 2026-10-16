import { describe, expect, it } from "vitest";
import { unreviewedInputs, vendoredEntries, vendoredPackageIds } from "./vendored-notices.ts";

describe("vendored packages", () => {
  const sources = [
    "../../../node_modules/.pnpm/ajv-formats@3.0.1_ajv@8.18.0/node_modules/ajv-formats/dist/index.js",
    "../../../node_modules/.pnpm/ajv@8.18.0/node_modules/ajv/dist/ajv.js",
    "../../../node_modules/.pnpm/@cfworker+json-schema@4.1.1/node_modules/@cfworker/json-schema/dist/esm/validate.js",
    "../../core-internal/src/validators/ajvProvider.ts",
  ];

  it("names each inlined package once, with scope and without peer suffixes", () => {
    expect(vendoredPackageIds(sources)).toStrictEqual([
      "@cfworker/json-schema@4.1.1",
      "ajv-formats@3.0.1",
      "ajv@8.18.0",
    ]);
  });

  it.each([
    "../../node_modules/ajv/dist/ajv.js",
    "../../node_modules/.pnpm/ajv/node_modules/ajv/dist/ajv.js",
  ])("fails for a node_modules source it cannot attribute: %s", (source) => {
    expect(() => vendoredPackageIds([source])).toThrow("cannot tell which package");
  });

  it("fails for an inlined package without a recorded license", () => {
    expect(() => vendoredEntries(sources, {}, new Set())).toThrow(
      "@cfworker/json-schema@4.1.1 is inlined into a bundled dependency but has no entry in scripts/vendored-licenses.json",
    );
  });

  it("turns recorded licenses into entries and skips packages already covered", () => {
    const vendored = {
      "ajv@8.18.0": { license: "MIT", text: "ajv text" },
      "ajv-formats@3.0.1": { license: "MIT", text: "formats text" },
    };

    expect(vendoredEntries(sources.slice(0, 2), vendored, new Set(["ajv@8.18.0"]))).toStrictEqual([
      { name: "ajv-formats", version: "3.0.1", license: "MIT", texts: ["formats text"] },
    ]);
  });
});

describe("unreviewedInputs", () => {
  const inputs = [
    { name: "zod", file: "index.js" },
    { name: "@scope/mapped", file: "dist/chunk.mjs" },
    { name: "@scope/mapped", file: "dist/barrel.mjs" },
  ];

  it("lists map-less files that nobody has reviewed, even inside packages with other mapped files", () => {
    expect(
      unreviewedInputs(inputs, { packages: ["zod"], files: ["@scope/mapped/dist/chunk.mjs"] }),
    ).toStrictEqual(["@scope/mapped/dist/barrel.mjs"]);
  });

  it("does not let a reviewed file cover a different file of the same package", () => {
    expect(unreviewedInputs(inputs, { packages: [], files: [] })).toHaveLength(3);
  });

  it("accepts a whole reviewed package", () => {
    expect(
      unreviewedInputs(inputs, { packages: ["zod", "@scope/mapped"], files: [] }),
    ).toStrictEqual([]);
  });
});
