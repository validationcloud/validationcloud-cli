import packageJson from "../../package.json" with { type: "json" };

export const packageInfo = { version: packageJson.version, description: packageJson.description };
