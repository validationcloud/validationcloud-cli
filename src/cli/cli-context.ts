import type { Credentials } from "#auth/resolve-credentials";
import type { CredentialStore } from "#auth/credential-store";
import type { ErrorMappingContext } from "#core/map-error";
import type { CatalogStore } from "#mcp/catalog-store";
import type { ResolvedGateway } from "#core/resolve-gateway";

export type CliContext = {
  gateway: ResolvedGateway;
  processEnv: NodeJS.ProcessEnv;
  credentialStore: CredentialStore;
  catalogStore: CatalogStore;
  usesStaticToken: boolean;
  wantsJson: boolean;
  credentials: () => Promise<Credentials>;
  failureContext: ErrorMappingContext;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};
