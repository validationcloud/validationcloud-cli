import { describe, expect, it } from "vitest";
import { nameCatalogFile } from "./name-catalog-file.ts";

describe("nameCatalogFile", () => {
  it.each([
    ["https://mcp.validationcloud.io/mcp", "catalog-72b347904edd56ee.json"],
    ["https://mcp.example.test/mcp", "catalog-098dba724f752c0f.json"],
    ["http://localhost:8080/mcp", "catalog-d9154b0edae8f1ea.json"],
  ])("names the catalog of %j %j", (gatewayUrl, fileName) => {
    expect(nameCatalogFile(gatewayUrl)).toBe(fileName);
  });
});
