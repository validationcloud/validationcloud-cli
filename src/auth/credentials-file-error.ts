export class CredentialsFileError extends Error {
  readonly filePath: string;

  constructor(filePath: string) {
    super(
      `credentials file ${filePath} is unreadable or corrupt; run 'valcloud auth logout' or delete the file, then log in again`,
    );
    this.name = "CredentialsFileError";
    this.filePath = filePath;
  }
}
