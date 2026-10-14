export class SilentExitError extends Error {
  readonly exitCode: number;

  constructor(exitCode: number) {
    super(`exit ${exitCode}`);
    this.name = "SilentExitError";
    this.exitCode = exitCode;
  }
}
