// The plugin list spells out semantic-release's defaults (with the exec step added) because the order matters: @semantic-release/npm writes the release version into package.json before the exec step bundles it into valcloud.mjs. The commit analyzer keeps its default rules on purpose: any custom releaseRules replace the default breaking-change rule, so a fix(runtime) commit with a BREAKING CHANGE footer would release a patch.
const config = {
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/npm",
    [
      "@semantic-release/exec",
      {
        prepareCmd: "node scripts/build-release.ts ${nextRelease.version}",
        // The smoke-install job in release.yml reads this output to know which version to expect.
        successCmd:
          '[ -n "$GITHUB_OUTPUT" ] || { echo "GITHUB_OUTPUT is not set, so the smoke-install job cannot learn the released version" >&2; exit 1; }; echo "version=${nextRelease.version}" >> "$GITHUB_OUTPUT"',
      },
    ],
    [
      "@semantic-release/github",
      {
        assets: [
          { path: "release/valcloud.mjs" },
          { path: "release/install.sh" },
          { path: "release/SHA256SUMS" },
        ],
      },
    ],
  ],
};

export default config;
