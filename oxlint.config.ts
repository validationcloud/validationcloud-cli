const config = {
  plugins: ["typescript", "unicorn", "oxc", "import", "promise", "node"],
  categories: {
    correctness: "error",
    suspicious: "error",
    pedantic: "error",
    perf: "error",
    style: "error",
    restriction: "error",
  },
  options: { typeAware: true },
  rules: {
    // Comments are short lowercase one-liners; capitalisation is not enforced.
    "capitalized-comments": "off",
    // Exhaustive switches over unions rely on TypeScript, not a default branch.
    "default-case": "off",
    // Function declarations and arrow functions are both used.
    "func-style": "off",
    // Short names such as `i` and `e` are fine in small scopes.
    "id-length": "off",
    // `let x: T;` assigned in branches is clearer than a dummy initial value.
    "init-declarations": "off",
    // Size and complexity are governed by fta-check (pnpm run fta), not by raw counts.
    "max-lines-per-function": "off",
    "max-params": "off",
    "max-statements": "off",
    // Retry, lock-polling and one-at-a-time stream handling await in loops on purpose.
    "no-await-in-loop": "off",
    // Guard clauses in loops follow the Early Returns rule.
    "no-continue": "off",
    // Meaningful numbers are named constants; the rule would also flag every 0, 1 and test literal.
    "no-magic-numbers": "off",
    // Conditional expressions are idiomatic here.
    "no-ternary": "off",
    // `T | undefined` is the repository convention (Optional Properties rule).
    "no-undefined": "off",
    "unicorn/no-useless-undefined": "off",
    // The target is Node 24, which supports async/await, optional chaining and object spread natively.
    "oxc/no-async-await": "off",
    "oxc/no-optional-chaining": "off",
    "oxc/no-rest-spread-properties": "off",
    // Wrapping callback APIs (readline, http servers, child processes) needs `new Promise`.
    "promise/avoid-new": "off",
    "promise/prefer-await-to-callbacks": "off",
    // An async function may satisfy a Promise-returning interface without awaiting.
    "require-await": "off",
    "typescript/promise-function-async": "off",
    // Import order and object key order follow meaning and the formatter, not alphabetical sorting.
    "sort-imports": "off",
    "sort-keys": "off",
    // Return types are annotated by hand on top-level source functions (Return Types rule); the rule would also demand them on test helpers and inline callbacks.
    "typescript/explicit-function-return-type": "off",
    // The few classes here use no accessibility modifiers.
    "typescript/explicit-member-accessibility": "off",
    // Values at a boundary (JSON.parse results, error codes, the stub server's requests) are narrowed by assertion.
    "typescript/no-unsafe-type-assertion": "off",
    // Node and SDK types are mutable; requiring readonly parameters would fight their signatures.
    "typescript/prefer-readonly-parameter-types": "off",
    // JSON and the MCP protocol use null.
    "unicorn/no-null": "off",

    // Modern TypeScript idiom: top-level `import type { T }` alongside a runtime
    // `import { f }` from the same module.
    "no-duplicate-imports": "off",

    // `void somePromise()` is the fire-and-forget idiom; don't flag it.
    "no-void": "off",

    // Named exports only, no barrels (Module Exports rule); config files need default exports.
    "import/prefer-default-export": "off",
    "import/no-named-export": "off",
    "import/no-default-export": "off",
    "import/exports-last": "off",
    "import/group-exports": "off",
    "import/no-namespace": "off",
    // A Node CLI imports node: built-ins everywhere.
    "import/no-nodejs-modules": "off",
    "import/max-dependencies": "off",
    // package.json is imported by relative path (Import Metadata rule); layers use `#layer/*` imports.
    "import/no-relative-parent-imports": "off",

    // The repository rules (AGENTS.md) write object shapes as `type` aliases, alongside unions and Zod-inferred types.
    "typescript/consistent-type-definitions": "off",

    // The Early Returns rule in AGENTS.md uses single-statement guard clauses without braces.
    curly: "off",

    // One declaration per binding keeps annotations and diffs readable; merging consecutive consts adds nothing.
    "one-var": "off",

    // AGENTS.md (Zod Schema Naming) gives a schema and its inferred type the same name; FailureKind pairs a const with its type.
    "no-redeclare": "off",

    // AGENTS.md (Cross-Platform Path Validation) imports named functions from node:path.
    "unicorn/import-style": "off",

    // Zod schema composition and `expect(call(...))` nest calls by design.
    "unicorn/max-nested-calls": "off",

    // Exhaustive switches over a union return on every path; TypeScript rejects a missing case.
    "typescript/consistent-return": "off",

    // src/cli.ts is a program entry point, never loaded through require(esm); unicorn/prefer-top-level-await asks for the opposite.
    "node/no-top-level-await": "off",

    // Configuration arrives through documented environment variables (VC_TOKEN, VC_MCP_URL, CI).
    "node/no-process-env": "off",
    "import/no-unassigned-import": ["error", { allow: ["@total-typescript/ts-reset"] }],
  },
  overrides: [
    {
      files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx"],
      plugins: ["vitest"],
      rules: {
        // Tests import from vitest explicitly, use beforeEach/afterEach for temp homes and servers, and need no assertion counts or describe-per-file.
        "vitest/no-hooks": "off",
        "vitest/no-importing-vitest-globals": "off",
        "vitest/prefer-describe-function-title": "off",
        "vitest/prefer-expect-assertions": "off",
        // Titles name identifiers and variables such as VC_MCP_URL and JSON, which the autofix would lowercase into nonsense.
        "vitest/prefer-lowercase-title": "off",
        // `prefer-strict-boolean-matchers` (baseline) prefers `toBe(false)`;
        // `prefer-to-be-falsy` flags the same call back to `toBeFalsy()`. Pick one.
        "vitest/prefer-to-be-falsy": "off",
        // Strict boolean matchers (`toBe(true)`) are preferred over truthiness matchers.
        "vitest/prefer-to-be-truthy": "off",
        "vitest/require-top-level-describe": "off",
        // The suite's default timeout is set in vitest.config.ts.
        "vitest/require-test-timeout": "off",
      },
    },
    {
      files: ["test/*.integration.test.ts"],
      rules: {
        // Integration suites keep their scenarios in one file; fta-check does not measure test files.
        "max-lines": "off",
      },
    },
    {
      files: ["src/auth/capture-sdk-console.ts", "src/auth/capture-sdk-console.test.ts"],
      rules: {
        // Capturing the SDK's console output is the purpose of these files.
        "no-console": "off",
      },
    },
  ],
};

export default config;
