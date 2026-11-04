export type IntegrationProviderKind = string;
export type IntegrationCapability = 'source_control' | 'agent_tools' | 'interaction';
export type IntegrationConnectionLifecycleStatus = 'active' | 'disabled' | 'error';
export type IntegrationConnectionRepositoryAccessMode = 'selected' | 'all';

const GIT_OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const ZERO_GIT_OBJECT_ID_PATTERN = /^0+$/;

export interface IntegrationConnection<
  ProviderKind extends IntegrationProviderKind = IntegrationProviderKind,
> {
  id: string;
  workspaceId: string;
  provider: ProviderKind;
  externalAccountId: string;
  slug: string;
  displayName: string;
  lifecycleStatus: IntegrationConnectionLifecycleStatus;
  repositoryAccessMode: IntegrationConnectionRepositoryAccessMode;
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

export interface ResolveRefInput<Connection extends IntegrationConnection = IntegrationConnection>
  extends ResolveRepositoryInput<Connection> {
  ref: string;
}

export interface ResolvedRef {
  ref: string;
  commit: string;
}

export interface FileSnapshot {
  path: string;
  ref: string;
  content: string;
}

/** Symlinks and submodules are listed so callers can reject them rather than miss them. */
export type FileEntryType = 'file' | 'symlink' | 'submodule';

export interface FileEntry {
  path: string;
  type: FileEntryType;
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

export interface ListCommitsInput<Connection extends IntegrationConnection = IntegrationConnection>
  extends ResolveRepositoryInput<Connection> {
  ref: string;
  /** A file or folder. `.shipfox` lists every config change. */
  path: string;
  /** A positive integer. */
  limit: number;
  cursor?: string | undefined;
}

export interface CommitSummary {
  oid: string;
  message: string;
  authorName: string;
  authoredAt: Date;
  /** Set by providers with their own commit page. */
  htmlUrl?: string | undefined;
}

export interface CommitPage {
  /** Can hold fewer than `limit` commits while `nextCursor` is set. */
  commits: CommitSummary[];
  nextCursor: string | null;
}

export interface ConfigPullRequest {
  url: string;
  number: number;
  /** `closed` means closed without a merge. */
  state: 'open' | 'merged' | 'closed';
}

export interface GetConfigPullRequestInput<
  Connection extends IntegrationConnection = IntegrationConnection,
> extends ResolveRepositoryInput<Connection> {
  /** The branch the pull request was opened from. */
  branch: string;
}

export interface OpenConfigPullRequestInput<
  Connection extends IntegrationConnection = IntegrationConnection,
> extends GetConfigPullRequestInput<Connection> {
  /** The whole tree to add on top of the default branch. */
  files: readonly {path: string; content: string}[];
  title: string;
  body: string;
}

export type CheckoutCredentialRenewal =
  | {mode: 'refresh-at'; refreshAt: Date}
  | {mode: 'on-rejection'};

export interface CheckoutCredentials {
  username: string;
  token: string;
  expiresAt: Date;
  /** Opaque, non-secret value identifying this credential delivery. */
  generation?: string | undefined;
  renewal?: CheckoutCredentialRenewal | undefined;
}

export interface CheckoutGitAuthor {
  name: string;
  email: string;
}

export interface CheckoutPermissions {
  contents: 'read' | 'write';
}

export interface CheckoutSpec {
  repositoryUrl: string;
  ref: string;
  /** Provider-resolved identity for renewing a checkout addressed by name. */
  target?: CheckoutTarget | undefined;
  credentials?: CheckoutCredentials | undefined;
  gitAuthor?: CheckoutGitAuthor | undefined;
}

export type CheckoutTarget =
  | {kind: 'external-id'; externalRepositoryId: string}
  | {kind: 'name'; owner: string; name: string};

/**
 * Checkout callers may use the legacy external repository id field while
 * integrations migrate to the explicit target contract. Name targets must be
 * authorized by the owning project/workflow boundary before reaching the SPI.
 */
export interface CheckoutTargetInput {
  target?: CheckoutTarget | undefined;
  externalRepositoryId?: string | undefined;
}

export type CheckoutTargetNormalizationResult =
  | {status: 'valid'; target: CheckoutTarget}
  | {status: 'missing'}
  | {status: 'ambiguous'};

/** Classifies checkout input so callers can preserve missing versus ambiguous errors. */
export function normalizeCheckoutTarget(
  input: CheckoutTargetInput,
): CheckoutTargetNormalizationResult {
  if (input.target !== undefined && input.externalRepositoryId !== undefined) {
    return {status: 'ambiguous'};
  }
  if (input.target !== undefined) return {status: 'valid', target: input.target};
  if (input.externalRepositoryId !== undefined) {
    return {
      status: 'valid',
      target: {kind: 'external-id', externalRepositoryId: input.externalRepositoryId},
    };
  }
  return {status: 'missing'};
}

export type CreateCheckoutSpecInput<
  Connection extends IntegrationConnection = IntegrationConnection,
> = {
  connection: Connection;
  projectId?: string | undefined;
  ref?: string | undefined;
  permissions?: CheckoutPermissions | undefined;
} & CheckoutTargetInput;

/** Requests credentials without asking the provider to resolve repository metadata. */
export type CreateCheckoutCredentialsInput<
  Connection extends IntegrationConnection = IntegrationConnection,
> = {
  connection: Connection;
  projectId?: string | undefined;
  permissions: CheckoutPermissions;
  rejectedGeneration?: string | undefined;
} & CheckoutTargetInput;

export interface TriggerReference {
  externalRepositoryId: string;
  ref: string;
  commit: string;
  /** Provider handle of whoever caused the event, when the payload names one. */
  actor: string | null;
}

/** The kind of resource a project can be limited to inside a connection, such as a repository. */
export interface ProviderResourceKind {
  kind: string;
  label: string;
}

/** A resource a project can be limited to, as a provider names it. */
export interface ScopeResource {
  kind: string;
  /** The provider id. For a repository it equals `externalRepositoryId`. */
  externalId: string;
  /** Lowercase match key for name targets, such as `acme/app`. */
  lookupName: string;
  /** As the provider returns it, such as `acme/App`. */
  displayName: string;
}

export interface ScopeResourcePage {
  resources: ScopeResource[];
  nextCursor: string | null;
}

export interface ListScopeResourcesInput<
  Connection extends IntegrationConnection = IntegrationConnection,
> {
  connection: Connection;
  kind: string;
  limit: number;
  cursor?: string | undefined;
  query?: string | undefined;
}

export interface ResolveScopeResourceInput<
  Connection extends IntegrationConnection = IntegrationConnection,
> {
  connection: Connection;
  kind: string;
  externalId: string;
}

export const REPOSITORY_RESOURCE_KIND = 'repository';

export function repositoryToScopeResource(repository: RepositorySnapshot): ScopeResource {
  return {
    kind: REPOSITORY_RESOURCE_KIND,
    externalId: repository.externalRepositoryId,
    lookupName: repository.fullName.toLowerCase(),
    displayName: repository.fullName,
  };
}

/**
 * The resource a source-control event carries, so triggers can filter by repository. `externalId`
 * is the stored repository id, and `fullName` is the provider's `owner/name`.
 */
export function repositoryEventResource(input: {externalRepositoryId: string; fullName: string}): {
  kind: string;
  externalId: string;
  lookupName: string;
} {
  return {
    kind: REPOSITORY_RESOURCE_KIND,
    externalId: input.externalRepositoryId,
    lookupName: input.fullName.toLowerCase(),
  };
}

/**
 * The scope resources of a source-control provider whose only kind is the repository, on top of
 * its `listRepositories` and `resolveRepository`.
 */
export function repositoryScopeResources<Connection extends IntegrationConnection>(
  sourceControl: Pick<SourceControlProvider<Connection>, 'listRepositories' | 'resolveRepository'>,
) {
  return {
    resourceKinds: [{kind: REPOSITORY_RESOURCE_KIND, label: 'Repositories'}] as const,
    async listScopeResources(
      input: ListScopeResourcesInput<Connection>,
    ): Promise<ScopeResourcePage> {
      if (input.kind !== REPOSITORY_RESOURCE_KIND) return {resources: [], nextCursor: null};
      const page = await sourceControl.listRepositories({
        connection: input.connection,
        limit: input.limit,
        cursor: input.cursor,
        search: input.query,
      });
      return {
        resources: page.repositories.map(repositoryToScopeResource),
        nextCursor: page.nextCursor,
      };
    },
    async resolveScopeResource(
      input: ResolveScopeResourceInput<Connection>,
    ): Promise<ScopeResource | null> {
      if (input.kind !== REPOSITORY_RESOURCE_KIND) return null;
      try {
        return repositoryToScopeResource(
          await sourceControl.resolveRepository({
            connection: input.connection,
            externalRepositoryId: input.externalId,
          }),
        );
      } catch (error) {
        if (error instanceof IntegrationProviderError && error.reason === 'repository-not-found') {
          return null;
        }
        throw error;
      }
    },
  };
}

export type CheckoutRepositoryAuthorizationState = 'enforced' | 'unclassified';

export interface SourceControlProvider<
  Connection extends IntegrationConnection = IntegrationConnection,
> {
  /** Whether integration core must authorize repository targets before checkout dispatch. */
  checkoutRepositoryAuthorization?: CheckoutRepositoryAuthorizationState | undefined;
  listRepositories(input: ListRepositoriesInput<Connection>): Promise<RepositoryPage>;
  resolveRepository(input: ResolveRepositoryInput<Connection>): Promise<RepositorySnapshot>;
  listFiles(input: ListFilesInput<Connection>): Promise<FilePage>;
  fetchFile(input: FetchFileInput<Connection>): Promise<FileSnapshot>;
  resolveTriggerReference(payload: unknown): TriggerReference | null;
  /**
   * Pins a branch or tag name to the commit it currently points at.
   * The snapshot can become unreachable before a caller uses it.
   */
  resolveRef(input: ResolveRefInput<Connection>): Promise<ResolvedRef>;
  /** Lists the commits that changed one path, newest first. */
  listCommits?(input: ListCommitsInput<Connection>): Promise<CommitPage>;
  /**
   * Opens a pull request from `branch` that adds `files` on top of the default branch. Idempotent
   * on `branch`: it looks for a pull request from that branch in any state first, so a retry after
   * a lost response gets the same pull request back.
   */
  openConfigPullRequest?(input: OpenConfigPullRequestInput<Connection>): Promise<ConfigPullRequest>;
  /** The lookup behind `openConfigPullRequest`, with no write. Null when no pull request exists. */
  getConfigPullRequest?(
    input: GetConfigPullRequestInput<Connection>,
  ): Promise<ConfigPullRequest | null>;
  createCheckoutSpec?(input: CreateCheckoutSpecInput<Connection>): Promise<CheckoutSpec>;
  createCheckoutCredentials?(
    input: CreateCheckoutCredentialsInput<Connection>,
  ): Promise<CheckoutCredentials>;
}

export type AgentToolSensitivity = 'read' | 'write';
export type AgentToolJsonSchema = Record<string, unknown>;

export type AgentToolRepositoryAuthorizationState = 'enforced' | 'unclassified';

export interface AgentToolRepositoryTarget {
  owner: string;
  name: string;
}

export type AgentToolRepositoryScope =
  | {kind: 'declared-targets'; repositories: readonly AgentToolRepositoryTarget[]}
  | {
      kind: 'connection';
      /**
       * Selected-mode calls must declare repository targets when this is true.
       * All-mode calls remain connection-scoped without those targets.
       */
      requiresExplicitRepository?: boolean;
      /** Explains why a connection-scoped read may reach outside a target. */
      indirectTargetNote?: string | undefined;
    };

/** A pure classifier over already validated tool arguments. */
export type AgentToolRepositoryScopeClassifier = (
  arguments_: Readonly<Record<string, unknown>>,
) => AgentToolRepositoryScope;

export interface AgentToolCatalogMethod<RequiredScope = unknown> {
  id: string;
  description: string;
  sensitivity: AgentToolSensitivity;
  sensitive: boolean;
  requiredScope: RequiredScope;
  repositoryScope?: AgentToolRepositoryScopeClassifier | undefined;
  indirectTargetNote?: string | undefined;
}

/**
 * `file` tools return bytes rather than JSON, so agents cannot receive their result.
 * `image` tools return image content: an agent can receive it, but a tool step and an action
 * only read JSON, so neither can call them.
 */
export type AgentToolResultKind = 'json' | 'file' | 'image';

export interface AgentToolCatalogEntry<RequiredScope = unknown> {
  id: string;
  description: string;
  sensitivity: AgentToolSensitivity;
  sensitive: boolean;
  requiredScope: RequiredScope;
  inputSchema: AgentToolJsonSchema;
  outputSchema?: AgentToolJsonSchema | undefined;
  /** Defaults to `json`. */
  result?: AgentToolResultKind | undefined;
  repositoryScope?: AgentToolRepositoryScopeClassifier | undefined;
  indirectTargetNote?: string | undefined;
  methods?: readonly AgentToolCatalogMethod<RequiredScope>[] | undefined;
}

export function agentToolResultKind(
  entry: Pick<AgentToolCatalogEntry, 'result'>,
): AgentToolResultKind {
  return entry.result ?? 'json';
}

/**
 * Verifies the catalog contract needed before a provider can be marked enforced.
 * This deliberately checks presence only; classifier behavior remains provider-owned.
 */
export function assertAgentToolCatalogRepositoryScopes(
  catalog: readonly AgentToolCatalogEntry[],
): void {
  for (const entry of catalog) {
    if (entry.repositoryScope === undefined) {
      throw new Error(`Agent tool ${entry.id} is missing a repository scope classifier`);
    }
    for (const method of entry.methods ?? []) {
      if (method.repositoryScope === undefined) {
        throw new Error(
          `Agent tool ${entry.id}.${method.id} is missing a repository scope classifier`,
        );
      }
    }
  }
}

export type AgentToolSelectorKind = 'family' | 'family_wildcard' | 'method' | 'standalone';

export interface AgentToolSelector {
  readonly token: string;
  readonly kind: AgentToolSelectorKind;
  readonly sensitivity: AgentToolSensitivity;
  readonly sensitive: boolean;
}

export interface AgentToolSelectionCatalog {
  readonly selectors: readonly AgentToolSelector[];
}

export interface AgentToolCallInput {
  toolId: string;
  arguments: Record<string, unknown>;
}

export interface AgentToolSession<CallResult = unknown> {
  call(input: AgentToolCallInput): Promise<CallResult>;
  close?(): Promise<void>;
}

export interface AgentToolsRunCallerContext {
  /** Identifies whether the call came from deterministic tool execution or an agent lease. */
  callerKind?: 'agent' | 'tool_step' | undefined;
  workspaceId: string;
  projectId: string;
  runId: string;
  jobExecutionId: string;
  stepId: string;
  stepAttempt: number;
}

export interface AgentToolsConversationCallerContext {
  callerKind: 'conversation';
  workspaceId: string;
  /** The only project the call may reach. */
  projectId: string;
  conversationId: string;
  agentKey: string;
  turnId: string;
  callItemId: string;
  /** Absent when the conversation has no Shipfox user, as on an integration origin. */
  actorUserId?: string | undefined;
  /** The provider of an integration conversation, such as `slack`. Absent for the web. */
  originProvider?: string | undefined;
}

export type AgentToolsCallerContext =
  | AgentToolsRunCallerContext
  | AgentToolsConversationCallerContext;

export interface OpenAgentToolsSessionInput<
  Connection extends IntegrationConnection = IntegrationConnection,
  RequiredScope = unknown,
  ProviderScope = unknown,
> {
  connection: Connection;
  tools: readonly AgentToolCatalogEntry<RequiredScope>[];
  scope: ProviderScope;
  caller?: AgentToolsCallerContext | undefined;
}

/** The largest file a file tool may return. The gateway enforces it while streaming. */
export const MAX_AGENT_TOOL_FILE_BYTES = 100 * 1024 * 1024;

export interface AgentToolDownloadFileInput<
  Connection extends IntegrationConnection = IntegrationConnection,
> {
  connection: Connection;
  toolId: string;
  arguments: Record<string, unknown>;
  /**
   * Aborted on the download deadline or when the caller disconnects. Pass it to
   * the provider fetch and to the returned body, so an abandoned transfer stops.
   */
  signal: AbortSignal;
}

export interface AgentToolFileDownload {
  body: ReadableStream<Uint8Array>;
  mediaType: string;
  filename?: string | undefined;
  /** Byte length, when the provider announces it. */
  size?: number | undefined;
}

export interface AgentToolsProvider<
  Connection extends IntegrationConnection = IntegrationConnection,
  RequiredScope = unknown,
  ProviderScope = unknown,
  CallResult = unknown,
> {
  catalog():
    | readonly AgentToolCatalogEntry<RequiredScope>[]
    | Promise<readonly AgentToolCatalogEntry<RequiredScope>[]>;
  /**
   * The tools a conversation can call, with schemas shaped for a caller bound to one project.
   * A provider without this method offers a conversation nothing.
   */
  conversationCatalog?():
    | readonly AgentToolCatalogEntry<RequiredScope>[]
    | Promise<readonly AgentToolCatalogEntry<RequiredScope>[]>;
  selectionCatalog(): AgentToolSelectionCatalog | Promise<AgentToolSelectionCatalog>;
  openSession(
    input: OpenAgentToolsSessionInput<Connection, RequiredScope, ProviderScope>,
  ): Promise<AgentToolSession<CallResult>>;
  /** Serves the catalog's `file` tools. Required when the catalog declares one. */
  downloadFile?(input: AgentToolDownloadFileInput<Connection>): Promise<AgentToolFileDownload>;
}

/** What an event does to a conversation: starts one, continues one, or stops its running turn. */
export type InteractionRole = 'request' | 'follow_up' | 'stop';
export type InteractionReplyKind = 'response' | 'error';
export type InteractionProgressState = 'working' | 'idle';

export interface Interaction {
  conversationKey: string;
  role: InteractionRole;
  /** Where the request was made. Routing filters read it as `request`. */
  context: Record<string, unknown>;
  /** Absent when no person caused it. */
  author?: {externalId: string; displayName?: string | undefined} | undefined;
  /** Prose for the model. Treated as untrusted data. */
  text: string;
}

export interface ReadInteractionInput<
  Connection extends IntegrationConnection = IntegrationConnection,
> {
  connection: Connection;
  event: string;
  payload: unknown;
}

export interface SendInteractionReplyInput<
  Connection extends IntegrationConnection = IntegrationConnection,
> {
  connection: Connection;
  conversationKey: string;
  /**
   * A UUID, stable across retries. A send can land without the caller learning it, so a provider
   * whose platform accepts a client-chosen id uses this one and reports a repeat as `delivered`.
   */
  replyId: string;
  kind: InteractionReplyKind;
  /** Markdown. The provider converts it. */
  text: string;
  agent: {name: string};
}

export type InteractionReplyOutcome =
  | {outcome: 'delivered'}
  | {outcome: 'undeliverable'; reason: string};

export interface ReportInteractionProgressInput<
  Connection extends IntegrationConnection = IntegrationConnection,
> {
  connection: Connection;
  conversationKey: string;
  state: InteractionProgressState;
  /** Such as a tool's label. */
  detail?: string | undefined;
  /** Such as the run link. */
  links?: {label: string; url: string}[] | undefined;
}

/**
 * Lets people talk to agents through a provider. The provider acknowledges a request in its
 * webhook path, before the outbox, so acknowledgment is not part of this contract.
 */
export interface InteractionProvider<
  Connection extends IntegrationConnection = IntegrationConnection,
> {
  /** What each event can do. An event not listed never reaches an agent. */
  interactionEvents: Readonly<Record<string, InteractionRole>>;
  /** JSON Schema of `Interaction.context`, for docs and filter checks. */
  requestContextSchema: Record<string, unknown>;
  /** Returns undefined for an event that isn't meant for an agent. */
  readInteraction(input: ReadInteractionInput<Connection>): Promise<Interaction | undefined>;
  sendReply(input: SendInteractionReplyInput<Connection>): Promise<InteractionReplyOutcome>;
  /** Shows work in progress, and clears it with `idle`. */
  reportProgress?(input: ReportInteractionProgressInput<Connection>): Promise<void>;
  /** Plain prose for the system prompt: length, tone, and format on this surface. */
  replyGuidance: string;
}

export interface IntegrationProviderAdapters<
  Connection extends IntegrationConnection = IntegrationConnection,
> {
  source_control?: SourceControlProvider<Connection> | undefined;
  agent_tools?: AgentToolsProvider<Connection> | undefined;
  interaction?: InteractionProvider<Connection> | undefined;
}

/** Processes one provider-neutral inbound webhook request. */
export interface WebhookRequestProcessor {
  process(
    request: import('@shipfox/api-integration-core-dto').StoredWebhookRequest,
  ): Promise<import('@shipfox/api-integration-core-dto').WebhookProcessingResult>;
}

export interface IntegrationProvider<
  ProviderKind extends IntegrationProviderKind = IntegrationProviderKind,
  Route = unknown,
  Connection extends IntegrationConnection<ProviderKind> = IntegrationConnection<ProviderKind>,
> {
  provider: ProviderKind;
  displayName: string;
  /**
   * Marks a provider Shipfox runs for itself. `registry.list` leaves it out, so no gallery, picker,
   * connection list, or capability snapshot shows it. `registry.get` still finds it, because source
   * reads need its adapters.
   */
  internal?: boolean | undefined;
  /** Whether this provider has completed repository-scope classification. */
  repositoryAuthorization?: AgentToolRepositoryAuthorizationState | undefined;
  /**
   * The event names this provider documents for its handler.
   * Provider-minted names are never treated as a closed set by validation; the
   * catalog is a curated diagnostic aid and may omit provider events. Providers
   * without a documented catalog, including built-in trigger sources, omit it.
   */
  eventCatalog?: import('@shipfox/api-integration-core-dto').IntegrationEventCatalog | undefined;
  /** The resource kinds a project can be limited to on this provider's connections. */
  resourceKinds?: readonly ProviderResourceKind[] | undefined;
  listScopeResources?(input: ListScopeResourcesInput<Connection>): Promise<ScopeResourcePage>;
  /** Null when the connection can't see the resource. */
  resolveScopeResource?(
    input: ResolveScopeResourceInput<Connection>,
  ): Promise<ScopeResource | null>;
  adapters?: IntegrationProviderAdapters<Connection> | undefined;
  routes?: Route[] | undefined;
  connectionExternalUrl?(connection: Connection): Promise<string | undefined>;
  /**
   * Called for a connection that isn't active, and when a user activates one. Undefined when the
   * provider reports nothing.
   */
  connectionProviderAccess?(
    connection: Connection,
  ): Promise<
    import('@shipfox/api-integration-core-dto').IntegrationConnectionProviderAccess | undefined
  >;
  /**
   * Whether an active connection must be connected again, such as when it predates a scope the
   * provider now requires. Its page asks for that, and agents ignore its events until then.
   */
  connectionReconnectRequired?(connection: Connection): Promise<boolean>;
  /** Prepares provider-owned remote cleanup and returns a callback for after local deletion commits. */
  deleteConnectionRemoteResources?(
    connection: Connection,
  ): Promise<(() => Promise<void>) | undefined>;
  /** Serializes connection deletion with provider operations that can recreate remote resources. */
  withConnectionDeletionLock?(connection: Connection, fn: () => Promise<void>): Promise<void>;
  deleteConnectionRecords?(connection: Connection, options: {tx: unknown}): Promise<void>;
  deleteConnectionSecrets?(connection: Connection): Promise<void>;
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
  | 'installation-not-found'
  | 'installation-inactive'
  | 'file-not-found'
  | 'ref-not-found'
  | 'not-found'
  | 'ref-invalid'
  | 'access-denied'
  | 'rate-limited'
  | 'timeout'
  | 'credentials-unavailable'
  | 'provider-unavailable'
  | 'provider-rejected'
  | 'malformed-provider-response'
  | 'content-too-large'
  | 'too-many-files'
  | 'binary-file-unsupported'
  | 'search-qualifier-conflict'
  | 'file-too-large'
  | 'file-location-not-allowed';

/**
 * Why a provider refused a write, for callers that react to the failure instead of reporting it.
 * `unprocessable` is the fallback for a refusal no other detail describes.
 */
export const INTEGRATION_PROVIDER_ERROR_DETAILS = [
  'stale-head',
  'branch-not-found',
  'branch-exists',
  'pull-request-exists',
  'no-commits-between',
  'protected-branch',
  'permission-denied',
  'unprocessable',
] as const;

export type IntegrationProviderErrorDetail = (typeof INTEGRATION_PROVIDER_ERROR_DETAILS)[number];

export class IntegrationProviderError extends Error {
  constructor(
    public readonly reason: IntegrationProviderErrorReason,
    message: string,
    public readonly retryAfterSeconds?: number | undefined,
    public readonly status?: number | undefined,
    public readonly detail?: IntegrationProviderErrorDetail | undefined,
  ) {
    super(message);
    this.name = 'IntegrationProviderError';
  }
}

export class ConnectionSlugConflictError extends Error {
  constructor(cause: unknown) {
    super('Could not allocate a unique integration connection slug. Try again.', {cause});
    this.name = 'ConnectionSlugConflictError';
  }
}

export const MAX_REPOSITORY_FILE_BYTES = 1_000_000;

const strictUtf8Decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});

/**
 * Decodes repository file bytes as UTF-8 text, or returns null when they are not
 * valid UTF-8. A byte order mark is kept so the text round-trips to the same bytes.
 */
export function decodeRepositoryFileText(bytes: Uint8Array): string | null {
  try {
    return strictUtf8Decoder.decode(bytes);
  } catch {
    return null;
  }
}

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

/**
 * A checkout ref is a branch or tag name, so `main` is allowed.
 * A leading dash is a git option (`git fetch origin --upload-pack=...`).
 */
export function isSafeCheckoutRef(ref: string): boolean {
  if (!ref || ref.startsWith('-') || ref.startsWith('+')) return false;
  if (ref.includes('/')) return isValidGitRefName(ref);
  return isValidGitRefName(`refs/heads/${ref}`);
}

/** Checks the constraints enforced by `git check-ref-format`. */
export function isValidGitRefName(ref: string): boolean {
  if (!ref || ref === '@' || ref.startsWith('-')) return false;
  if (
    !ref.includes('/') ||
    ref.startsWith('/') ||
    ref.endsWith('/') ||
    ref.includes('//') ||
    ref.includes('..') ||
    ref.includes('@{') ||
    ref.endsWith('.')
  ) {
    return false;
  }
  if (
    [...ref].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x20 || code === 0x7f || '~^:?*[\\'.includes(character);
    })
  ) {
    return false;
  }

  const components = ref.split('/');
  return components.every(
    (component) =>
      component.length > 0 && !component.startsWith('.') && !component.endsWith('.lock'),
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

export function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/** Validates a provider ref before it is passed to a git operation. */
export function isValidTriggerRef(ref: string): boolean {
  return isValidGitRefName(ref);
}

/**
 * Validates a ref the platform may resolve to a commit: any safe git ref name
 * except pull-request refs. Raw object ids do not satisfy the safe git ref
 * name rules because valid refs must contain a slash. `refs/pull/N/head` can
 * point at a fork and providers serve any commit in the repository network by
 * SHA, so accepting names only keeps resolutions on refs a member pushed to
 * the project repository.
 */
export function isValidResolvableRef(ref: string): boolean {
  return isValidTriggerRef(ref) && !ref.startsWith('refs/pull/');
}

export function isValidGitObjectId(value: string): boolean {
  return GIT_OBJECT_ID_PATTERN.test(value) && !ZERO_GIT_OBJECT_ID_PATTERN.test(value);
}
