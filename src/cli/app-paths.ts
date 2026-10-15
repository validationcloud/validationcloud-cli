import { join } from "node:path";
import envPaths from "env-paths";

const paths = envPaths("valcloud", { suffix: "" });

export const credentialsFilePath = join(paths.config, "credentials.json");
export const cacheDirectory = paths.cache;
