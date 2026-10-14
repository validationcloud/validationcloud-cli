import { join } from "node:path";
import envPaths from "env-paths";

const paths = envPaths("vcloud", { suffix: "" });

export const credentialsFilePath = join(paths.config, "credentials.json");
export const cacheDirectory = paths.cache;
