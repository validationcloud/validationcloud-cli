import { rename, rm, writeFile } from "node:fs/promises";

export async function writeFileAtomic(path: string, data: string, mode: number): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    await rm(temporaryPath, { force: true });
    await writeFile(temporaryPath, data, { mode, flag: "wx" });
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}
