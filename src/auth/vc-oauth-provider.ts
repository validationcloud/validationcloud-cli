import { randomBytes } from "node:crypto";
import type {
  OAuthClientInformationContext,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import { AuthRequiredError } from "./auth-required-error.ts";
import type { CredentialStore } from "./credential-store.ts";
import { REDIRECT_URL } from "./loopback-listener.ts";
import { RefreshFailedError } from "./refresh-failed-error.ts";

const DEFAULT_SCOPES = ["openid", "profile", "email"];

export type VcOAuthProviderOptions = {
  store: CredentialStore;
  key: string;
  onRedirect: ((authorizationUrl: URL) => Promise<void>) | undefined;
  ignoreStoredTokens: boolean;
};

function sameIssuer(left: string, right: string): boolean {
  return left.replace(/\/$/u, "") === right.replace(/\/$/u, "");
}

export class VcOAuthProvider implements OAuthClientProvider {
  readonly #options: VcOAuthProviderOptions;
  #codeVerifier: string | undefined;
  #state: string | undefined;
  #discoveryState: OAuthDiscoveryState | undefined;
  #loginTokens: StoredOAuthTokens | undefined;
  #handedOutRefreshToken: string | undefined;
  #tokensInvalidated = false;

  constructor(options: VcOAuthProviderOptions) {
    this.#options = options;
  }

  get #isLogin(): boolean {
    return this.#options.ignoreStoredTokens;
  }

  // oxlint-disable-next-line eslint/class-methods-use-this -- OAuthClientProvider is an instance interface
  get redirectUrl(): string {
    return REDIRECT_URL;
  }

  // oxlint-disable-next-line eslint/class-methods-use-this -- OAuthClientProvider is an instance interface
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Validation Cloud CLI (vcloud)",
      redirect_uris: [REDIRECT_URL],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: [...DEFAULT_SCOPES, "offline_access"].join(" "),
    };
  }

  // One value per provider, so the loopback listener can be told the state before the SDK builds the URL.
  state(): string {
    this.#state ??= randomBytes(32).toString("base64url");
    return this.#state;
  }

  async clientInformation(
    context?: OAuthClientInformationContext,
  ): Promise<StoredOAuthClientInformation | undefined> {
    const entry = await this.#options.store.read(this.#options.key);
    const client = entry?.client;
    if (this.#isLogin) return client;
    // The SDK registers a new client when this returns nothing or a client of another issuer; only login may do that.
    if (client === undefined) throw new AuthRequiredError();
    if (
      context !== undefined &&
      client.issuer !== undefined &&
      !sameIssuer(client.issuer, context.issuer)
    ) {
      throw new AuthRequiredError();
    }
    return client;
  }

  async saveClientInformation(client: StoredOAuthClientInformation): Promise<void> {
    const { store, key } = this.#options;
    await store.withLock(async () => {
      if (!this.#isLogin) {
        // Outside login the SDK may only stamp the issuer onto the client that login registered.
        const stored = await store.read(key);
        if (stored?.client?.client_id !== client.client_id) throw new AuthRequiredError();
      }
      await store.update(key, (entry) => ({ ...entry, client }));
    });
  }

  async tokens(): Promise<StoredOAuthTokens | undefined> {
    if (this.#isLogin) return this.#loginTokens;
    const entry = await this.#options.store.read(this.#options.key);
    const tokens = entry?.tokens;
    this.#handedOutRefreshToken = tokens?.refresh_token;
    return tokens;
  }

  async saveTokens(tokens: StoredOAuthTokens): Promise<void> {
    const keepRefreshToken = !this.#isLogin && tokens.refresh_token === undefined;
    this.#loginTokens = tokens;
    this.#tokensInvalidated = false;
    await this.#options.store.update(this.#options.key, (entry) => ({
      ...entry,
      tokens:
        keepRefreshToken && entry.tokens?.refresh_token !== undefined
          ? { ...tokens, refresh_token: entry.tokens.refresh_token }
          : tokens,
      tokensSavedAtMs: Date.now(),
    }));
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (this.#options.onRedirect === undefined) {
      // The SDK falls back to a new authorization when a refresh fails for a non-OAuth reason (5xx, network).
      if (this.#handedOutRefreshToken !== undefined && !this.#tokensInvalidated) {
        throw new RefreshFailedError();
      }
      throw new AuthRequiredError();
    }
    // The server's resource metadata omits offline_access, but the authorization server grants it.
    const requested = authorizationUrl.searchParams.get("scope")?.split(" ") ?? DEFAULT_SCOPES;
    const scopes = new Set([...requested, "offline_access"]);
    authorizationUrl.searchParams.set("scope", [...scopes].join(" "));
    await this.#options.onRedirect(authorizationUrl);
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.#codeVerifier = codeVerifier;
  }

  codeVerifier(): string {
    if (this.#codeVerifier === undefined) throw new Error("no PKCE code verifier was saved");
    return this.#codeVerifier;
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    this.#discoveryState = state;
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.#discoveryState;
  }

  // Another process may have rotated the refresh token since this one read it; its newer tokens must survive.
  async #invalidateStoredTokens(removeEntry: boolean): Promise<void> {
    const { store, key } = this.#options;
    await store.withLock(async () => {
      const entry = await store.read(key);
      if (
        entry?.tokens !== undefined &&
        entry.tokens.refresh_token !== this.#handedOutRefreshToken
      ) {
        return;
      }
      this.#tokensInvalidated = true;
      if (removeEntry) {
        await store.remove(key);
        return;
      }
      await store.update(key, ({ tokens: _tokens, tokensSavedAtMs: _savedAt, ...rest }) => rest);
    });
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    if (scope === "discovery") {
      this.#discoveryState = undefined;
    } else if (scope === "verifier") {
      this.#codeVerifier = undefined;
    } else if (scope === "client") {
      await this.#options.store.update(this.#options.key, ({ client: _client, ...rest }) => rest);
    } else if (this.#isLogin) {
      this.#loginTokens = undefined;
      if (scope === "all") {
        await this.#options.store.update(this.#options.key, ({ client: _client, ...rest }) => rest);
      }
    } else {
      await this.#invalidateStoredTokens(scope === "all");
    }
  }
}
