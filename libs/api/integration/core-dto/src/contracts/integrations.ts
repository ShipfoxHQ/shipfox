export type IntegrationProviderKind = string;
export type IntegrationCapability = 'source_control';
export type IntegrationConnectionLifecycleStatus = 'active' | 'disabled' | 'error';

export interface IntegrationConnection<
  ProviderKind extends IntegrationProviderKind = IntegrationProviderKind,
> {
  id: string;
  workspaceId: string;
  provider: ProviderKind;
  externalAccountId: string;
  displayName: string;
  lifecycleStatus: IntegrationConnectionLifecycleStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type RepositoryVisibility = 'public' | 'private' | 'internal' | 'unknown';

export interface RepositorySnapshot {
  externalRepositoryId: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  visibility: RepositoryVisibility;
  cloneUrl: string;
  htmlUrl: string;
}

export interface RepositoryPage {
  repositories: RepositorySnapshot[];
  nextCursor: string | null;
}

export interface ListRepositoriesInput<
  Connection extends IntegrationConnection = IntegrationConnection,
> {
  connection: Connection;
  limit: number;
  cursor?: string | undefined;
  search?: string | undefined;
}

export interface ResolveRepositoryInput<
  Connection extends IntegrationConnection = IntegrationConnection,
> {
  connection: Connection;
  externalRepositoryId: string;
}

export interface FileSnapshot {
  path: string;
  ref: string;
  content: string;
}

export interface FileEntry {
  path: string;
  type: 'file';
  size: number | null;
}

export interface FilePage {
  files: FileEntry[];
  nextCursor: string | null;
}

export interface ListFilesInput<Connection extends IntegrationConnection = IntegrationConnection>
  extends ResolveRepositoryInput<Connection> {
  ref: string;
  prefix: string;
  limit: number;
  cursor?: string | undefined;
}

export interface FetchFileInput<Connection extends IntegrationConnection = IntegrationConnection>
  extends ResolveRepositoryInput<Connection> {
  ref: string;
  path: string;
}

export interface CheckoutCredentials {
  username: string;
  token: string;
  expiresAt: Date;
}

export interface CheckoutSpec {
  /**
   * Clone URL that must never embed authentication material. Credentials live
   * only in `credentials` so a redaction helper can mask them; a provider that
   * embeds a token in this URL would bypass redaction and leak it into logs,
   * `git remote -v`, and persisted job rows.
   */
  repositoryUrl: string;
  ref: string;
  credentials?: CheckoutCredentials | undefined;
}

export interface CreateCheckoutSpecInput<
  Connection extends IntegrationConnection = IntegrationConnection,
> extends ResolveRepositoryInput<Connection> {
  ref?: string | undefined;
}

export interface SourceControlProvider<
  Connection extends IntegrationConnection = IntegrationConnection,
> {
  listRepositories(input: ListRepositoriesInput<Connection>): Promise<RepositoryPage>;
  resolveRepository(input: ResolveRepositoryInput<Connection>): Promise<RepositorySnapshot>;
  listFiles(input: ListFilesInput<Connection>): Promise<FilePage>;
  fetchFile(input: FetchFileInput<Connection>): Promise<FileSnapshot>;
  createCheckoutSpec?(input: CreateCheckoutSpecInput<Connection>): Promise<CheckoutSpec>;
}

export interface IntegrationProviderAdapters<
  Connection extends IntegrationConnection = IntegrationConnection,
> {
  source_control?: SourceControlProvider<Connection> | undefined;
}

export interface IntegrationProvider<
  ProviderKind extends IntegrationProviderKind = IntegrationProviderKind,
  Route = unknown,
  Connection extends IntegrationConnection<ProviderKind> = IntegrationConnection<ProviderKind>,
> {
  provider: ProviderKind;
  displayName: string;
  adapters?: IntegrationProviderAdapters<Connection> | undefined;
  routes?: Route[] | undefined;
  /**
   * Resolves the provider-side home of a connection (e.g. the Sentry org or the
   * GitHub installation settings page). Returns undefined when the connection has
   * no external home or the provider-side record is missing.
   */
  connectionExternalUrl?(connection: Connection): Promise<string | undefined>;
}

export interface RegisteredIntegrationProvider<
  ProviderKind extends IntegrationProviderKind = IntegrationProviderKind,
  Route = unknown,
  Connection extends IntegrationConnection<ProviderKind> = IntegrationConnection<ProviderKind>,
> extends IntegrationProvider<ProviderKind, Route, Connection> {
  adapters: IntegrationProviderAdapters<Connection>;
  capabilities: IntegrationCapability[];
}

export type IntegrationProviderErrorReason =
  | 'repository-not-found'
  | 'file-not-found'
  | 'access-denied'
  | 'rate-limited'
  | 'timeout'
  | 'provider-unavailable'
  | 'malformed-provider-response'
  | 'content-too-large'
  | 'too-many-files';

export class IntegrationProviderError extends Error {
  constructor(
    public readonly reason: IntegrationProviderErrorReason,
    message: string,
    public readonly retryAfterSeconds?: number | undefined,
  ) {
    super(message);
    this.name = 'IntegrationProviderError';
  }
}

export const MAX_REPOSITORY_FILE_BYTES = 1_000_000;

export function buildProviderRepositoryId(
  provider: IntegrationProviderKind,
  value: string,
): string {
  return `${provider}:${value}`;
}

export function parseProviderRepositoryId(
  externalRepositoryId: string,
  expectedProvider: IntegrationProviderKind,
): string {
  const separatorIndex = externalRepositoryId.indexOf(':');
  if (separatorIndex <= 0) {
    throw new IntegrationProviderError(
      'repository-not-found',
      `External repository id is missing a provider prefix: ${externalRepositoryId}`,
    );
  }
  const prefix = externalRepositoryId.slice(0, separatorIndex);
  const value = externalRepositoryId.slice(separatorIndex + 1);
  if (prefix !== expectedProvider) {
    throw new IntegrationProviderError(
      'repository-not-found',
      `External repository id ${externalRepositoryId} is not owned by provider ${expectedProvider}`,
    );
  }
  if (!value) {
    throw new IntegrationProviderError(
      'repository-not-found',
      `External repository id ${externalRepositoryId} is missing a provider-owned value`,
    );
  }
  return value;
}
