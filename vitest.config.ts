import { coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  ssr: { resolve: { conditions: ["vc-source"] } },
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30_000,
    passWithNoTests: true,
    coverage: {
      reporter: ["text", "html"],
      exclude: ["bin/*", ...coverageConfigDefaults.exclude],
    },
  },
});
