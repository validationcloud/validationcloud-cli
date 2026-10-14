export class RefreshFailedError extends Error {
  constructor() {
    super(
      "could not refresh the access token (the authorization server or the network failed); the stored credentials are intact, retry later",
    );
    this.name = "RefreshFailedError";
  }
}
