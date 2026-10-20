import {
  type GithubPushPayloadDto,
  githubInstallationRepositoriesPayloadSchema,
  githubPushPayloadSchema,
  githubRepositoryRenamedPayloadSchema,
  githubWebhookActionSchema,
  githubWebhookInstallationSchema,
} from '@shipfox/api-integration-github-dto';
import {
  buildProviderRepositoryId,
  type GetIntegrationConnectionByIdFn,
  type IntegrationTx,
  type PublishIntegrationEventReceivedFn,
  type PublishSourcePushFn,
  type PublishSourceRepositoryUpdatedFn,
  type RecordDeliveryOnlyFn,
  type SourcePushPayload,
  type SourceRepositoryIdentity,
  type UpdateIntegrationConnectionLifecycleStatusFn,
} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import type {GithubApiClient} from '#api/client.js';
import {GithubIntegrationProviderError} from '#core/errors.js';
import {
  type GithubInstallation,
  getGithubInstallationByInstallationId,
  lockGithubInstallationByInstallationId,
  markGithubInstallationDeleted,
  setGithubInstallationSuspendedAt,
} from '#db/installations.js';
import {
  deleteGithubUnlinkedInstallationByInstallationId,
  upsertGithubUnlinkedInstallation,
} from '#db/unlinked-installations.js';

const REFS_HEADS_PREFIX = 'refs/heads/';
const GITHUB_SOURCE = 'github';
// GitHub sends a `push` webhook for a branch deletion with `after` set to this all-zero SHA.
const DELETED_BRANCH_SHA = '0'.repeat(40);

export interface HandleGithubEventParams {
  tx: IntegrationTx;
  deliveryId: string;
  event: string;
  payload: unknown;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  publishSourceRepositoryUpdated: PublishSourceRepositoryUpdatedFn;
  publishSourcePush: PublishSourcePushFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  /** Claims the `provider:github` delivery row that `publishIntegrationEventReceived` also claims. */
  updateConnectionLifecycleStatus: UpdateIntegrationConnectionLifecycleStatusFn;
  github: Pick<GithubApiClient, 'getInstallation'>;
}

export type HandleGithubEventOutcome =
  | 'published'
  | 'duplicate'
  | 'published-envelope'
  | 'duplicate-envelope'
  | 'published-push-envelope-only'
  | 'duplicate-push-envelope-only'
  | 'installation-lifecycle'
  | 'duplicate-installation-lifecycle'
  | 'fork-pull-request'
  | 'unknown-installation'
  | 'missing-connection'
  | 'inactive-connection'
  | 'no-installation-id';

export interface HandleGithubEventResult {
  outcome: HandleGithubEventOutcome;
  installationTokenCleanup?: {workspaceId: string; installationId: number} | undefined;
  repositoryAuthorizationCacheInvalidationConnectionId?: string | undefined;
}

function isBranchDeletion(after: string): boolean {
  return after === DELETED_BRANCH_SHA;
}

interface GithubRepositoryIdentity {
  id?: string;
  fullName?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function repositoryIdentity(value: unknown): GithubRepositoryIdentity | undefined {
  if (!isRecord(value)) return undefined;

  const id =
    (typeof value.id === 'number' && Number.isInteger(value.id) ? String(value.id) : undefined) ??
    (typeof value.id === 'string' && value.id.trim() ? value.id.trim() : undefined);
  const fullName =
    typeof value.full_name === 'string' && value.full_name.trim()
      ? value.full_name.trim().toLowerCase()
      : undefined;
  if (!id && !fullName) return undefined;

  return {...(id ? {id} : {}), ...(fullName ? {fullName} : {})};
}

function areSameRepositories(
  head: GithubRepositoryIdentity,
  base: GithubRepositoryIdentity,
): boolean {
  if (head.id && base.id) return head.id === base.id;
  if (head.fullName && base.fullName) return head.fullName === base.fullName;
  return false;
}

function pullRequestRepositories(
  payload: unknown,
):
  | {head: GithubRepositoryIdentity | undefined; base: GithubRepositoryIdentity | undefined}
  | undefined {
  if (!isRecord(payload) || !isRecord(payload.pull_request)) return undefined;

  const pullRequest = payload.pull_request;
  const head = isRecord(pullRequest.head) ? repositoryIdentity(pullRequest.head.repo) : undefined;
  const base =
    (isRecord(pullRequest.base) ? repositoryIdentity(pullRequest.base.repo) : undefined) ??
    repositoryIdentity(payload.repository);
  return {head, base};
}

type GithubConnection = NonNullable<Awaited<ReturnType<GetIntegrationConnectionByIdFn>>>;

async function dispatchGithubEvent(
  params: HandleGithubEventParams,
  connection: GithubConnection,
  installationId: number,
  action: string | undefined,
): Promise<HandleGithubEventResult> {
  if (params.event === 'push') {
    const validated = githubPushPayloadSchema.safeParse(params.payload);
    if (!validated.success) {
      logger().warn(
        {deliveryId: params.deliveryId, issues: validated.error.issues},
        'github webhook push payload failed schema validation; publishing generic envelope only',
      );
      return publishGithubEnvelopeOnly({
        tx: params.tx,
        deliveryId: params.deliveryId,
        payload: params.payload,
        publishIntegrationEventReceived: params.publishIntegrationEventReceived,
        connection,
        event: 'push',
      });
    }
    return publishGithubPush({
      ...params,
      eventPayload: validated.data,
      rawPayload: params.payload,
      connection,
    });
  }

  const eventName = action ? `${params.event}.${action}` : params.event;
  const repositories = normalizeRepositoryUpdates(params.event, action, params.payload);
  if (repositories) {
    const result = await params.publishSourceRepositoryUpdated({
      tx: params.tx,
      provider: GITHUB_SOURCE,
      source: connection.slug,
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      connectionName: connection.displayName,
      deliveryId: params.deliveryId,
      receivedAt: new Date().toISOString(),
      rawPayload: params.payload,
      event: eventName,
      repositories,
    });
    return withInstallationTokenCleanup(
      {
        outcome: result.published ? 'published' : 'duplicate',
        ...(result.published
          ? {repositoryAuthorizationCacheInvalidationConnectionId: connection.id}
          : {}),
      },
      params.event,
      action,
      connection.workspaceId,
      installationId,
    );
  }

  const result = await publishGithubEnvelopeOnly({
    tx: params.tx,
    deliveryId: params.deliveryId,
    payload: params.payload,
    publishIntegrationEventReceived: params.publishIntegrationEventReceived,
    connection,
    event: eventName,
  });
  return withInstallationTokenCleanup(
    result,
    params.event,
    action,
    connection.workspaceId,
    installationId,
  );
}

async function dropInactiveConnectionEvent(args: {
  params: HandleGithubEventParams;
  connection: GithubConnection;
  installationId: number;
  action: string | undefined;
}): Promise<HandleGithubEventResult> {
  const {params, connection, installationId, action} = args;
  const logContext = {
    deliveryId: params.deliveryId,
    installationId,
    connectionId: connection.id,
    workspaceId: connection.workspaceId,
    lifecycleStatus: connection.lifecycleStatus,
  };
  // `disabled` is an expected steady state; only `error` is anomalous.
  if (connection.lifecycleStatus === 'error') {
    logger().warn(logContext, 'github webhook: connection in error state, dropping');
  } else {
    logger().info(logContext, 'github webhook: connection disabled, dropping');
  }
  await params.recordDeliveryOnly({
    tx: params.tx,
    provider: GITHUB_SOURCE,
    deliveryId: params.deliveryId,
  });
  return withInstallationTokenCleanup(
    {outcome: 'inactive-connection'},
    params.event,
    action,
    connection.workspaceId,
    installationId,
  );
}

export async function handleGithubEvent(
  params: HandleGithubEventParams,
): Promise<HandleGithubEventResult> {
  const actionEnvelope = githubWebhookActionSchema.safeParse(params.payload);
  const action = actionEnvelope.success ? actionEnvelope.data.action : undefined;

  const pullRequestRepos = pullRequestRepositories(params.payload);
  if (
    pullRequestRepos &&
    (!pullRequestRepos.head ||
      !pullRequestRepos.base ||
      !areSameRepositories(pullRequestRepos.head, pullRequestRepos.base))
  ) {
    logger().info(
      {
        deliveryId: params.deliveryId,
        event: params.event,
        reason:
          !pullRequestRepos.head || !pullRequestRepos.base
            ? 'repository_unresolved'
            : 'repositories_differ',
        headRepository: pullRequestRepos.head,
        baseRepository: pullRequestRepos.base,
      },
      'github webhook: fork or indeterminate pull request, dropping',
    );
    await params.recordDeliveryOnly({
      tx: params.tx,
      provider: GITHUB_SOURCE,
      deliveryId: params.deliveryId,
    });
    return {outcome: 'fork-pull-request'};
  }

  const installationEnvelope = githubWebhookInstallationSchema.safeParse(params.payload);
  const installationId = installationEnvelope.success
    ? installationEnvelope.data.installation?.id
    : undefined;
  if (installationId === undefined) {
    await params.recordDeliveryOnly({
      tx: params.tx,
      provider: GITHUB_SOURCE,
      deliveryId: params.deliveryId,
    });
    return {outcome: 'no-installation-id'};
  }

  await deleteGithubUnlinkedInstallationForDeletedEvent({
    tx: params.tx,
    event: params.event,
    action,
    installationId,
  });

  // Lifecycle events take the installation lock first, before any connection row, to match the
  // connect path's lock order. The connection is then read after the lock, so it is current.
  const lifecycleAction = installationLifecycleAction(params.event, action);
  const installation = lifecycleAction
    ? await lockGithubInstallationByInstallationId(String(installationId), {tx: params.tx})
    : await getGithubInstallationByInstallationId(String(installationId), {tx: params.tx});
  if (!installation) {
    logUnknownGithubInstallation({
      deliveryId: params.deliveryId,
      installationId,
      event: params.event,
      action,
      payload: params.payload,
    });
    await recordUnknownGithubInstallation({
      tx: params.tx,
      installationId,
      event: params.event,
      action,
      payload: params.payload,
    });
    await params.recordDeliveryOnly({
      tx: params.tx,
      provider: GITHUB_SOURCE,
      deliveryId: params.deliveryId,
    });
    return {outcome: 'unknown-installation'};
  }

  const connection = await params.getIntegrationConnectionById(installation.connectionId, {
    tx: params.tx,
  });
  if (!connection) {
    logger().warn(
      {deliveryId: params.deliveryId, installationId, connectionId: installation.connectionId},
      'github webhook: installation has no connection, dropping',
    );
    await params.recordDeliveryOnly({
      tx: params.tx,
      provider: GITHUB_SOURCE,
      deliveryId: params.deliveryId,
    });
    return {outcome: 'missing-connection'};
  }

  if (lifecycleAction) {
    return await applyGithubInstallationLifecycle({
      params,
      connection,
      installation,
      action: lifecycleAction,
    });
  }

  if (connection.lifecycleStatus !== 'active') {
    return await dropInactiveConnectionEvent({params, connection, installationId, action});
  }

  return dispatchGithubEvent(params, connection, installationId, action);
}

type InstallationLifecycleAction = 'deleted' | 'suspend' | 'unsuspend';

function installationLifecycleAction(
  event: string,
  action: string | undefined,
): InstallationLifecycleAction | undefined {
  if (event !== 'installation') return undefined;
  return action === 'deleted' || action === 'suspend' || action === 'unsuspend'
    ? action
    : undefined;
}

// Runs before the active-connection gate: `unsuspend` arrives while the connection is `error`.
// The caller holds the installation row lock, which serializes lifecycle events for one
// installation, so GitHub is read after any earlier handler committed and the last commit holds
// GitHub's latest state.
async function applyGithubInstallationLifecycle(args: {
  params: HandleGithubEventParams;
  connection: GithubConnection;
  installation: GithubInstallation;
  action: InstallationLifecycleAction;
}): Promise<HandleGithubEventResult> {
  const {params, connection, installation, action} = args;
  const {tx} = params;
  const installationKey = installation.installationId;
  const installationId = Number(installationKey);

  const claim = await claimInstallationLifecycleDelivery({params, connection, action});
  // Cleanup is idempotent and runs for a duplicate too, so a retry repeats a failed one.
  const result = withInstallationTokenCleanup(
    {outcome: claim.outcome},
    params.event,
    action,
    connection.workspaceId,
    installationId,
  );

  // A duplicate skips the write; the claim and the write share this transaction.
  if (!claim.claimed) return result;

  // `deleted_at` is terminal for an installation ID.
  if (action !== 'deleted' && installation.deletedAt) return result;

  if (action === 'deleted') {
    await applyInstallationDeleted({params, connection, installationKey});
    return result;
  }

  // Never fall back to the event payload: a delayed payload is the stale state this read rejects.
  const read = await readGithubInstallationState(params.github, installationId);
  if (read === 'not-found') {
    await applyInstallationDeleted({params, connection, installationKey});
    return result;
  }

  await setGithubInstallationSuspendedAt(
    {installationId: installationKey, suspendedAt: read.suspendedAt},
    {tx},
  );
  await params.updateConnectionLifecycleStatus(
    read.suspendedAt
      ? {id: connection.id, lifecycleStatus: 'error', expectedStatuses: ['active']}
      : {id: connection.id, lifecycleStatus: 'active', expectedStatuses: ['error']},
    {tx},
  );
  return result;
}

const INSTALLATION_READ_RETRY_DELAYS_MS = [200, 500];

// A failed read throws and rolls the transaction back, and a lost webhook is not redelivered on
// every deployment, so ride out a brief GitHub outage before giving up.
async function readGithubInstallationState(
  github: HandleGithubEventParams['github'],
  installationId: number,
): Promise<{suspendedAt: Date | null} | 'not-found'> {
  for (let attempt = 0; ; attempt++) {
    try {
      const {suspendedAt} = await github.getInstallation(installationId);
      return {suspendedAt};
    } catch (error) {
      if (!(error instanceof GithubIntegrationProviderError)) throw error;
      if (error.reason === 'installation-not-found') return 'not-found';
      const delay = INSTALLATION_READ_RETRY_DELAYS_MS[attempt];
      const transient = error.reason === 'provider-unavailable' || error.reason === 'timeout';
      if (!transient || delay === undefined) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function applyInstallationDeleted(args: {
  params: HandleGithubEventParams;
  connection: GithubConnection;
  installationKey: string;
}): Promise<void> {
  await markGithubInstallationDeleted(args.installationKey, {tx: args.params.tx});
  await args.params.updateConnectionLifecycleStatus(
    {id: args.connection.id, lifecycleStatus: 'error', expectedStatuses: ['active']},
    {tx: args.params.tx},
  );
}

// Publishes the envelope so `installation.*` triggers fire, unless the user disabled the
// connection. Not only `active`: an `unsuspend` or a later `deleted` arrives while a suspend left
// the connection in `error`, and those events must still reach their triggers.
async function claimInstallationLifecycleDelivery(args: {
  params: HandleGithubEventParams;
  connection: GithubConnection;
  action: InstallationLifecycleAction;
}): Promise<{claimed: boolean; outcome: HandleGithubEventOutcome}> {
  const {params, connection, action} = args;
  if (connection.lifecycleStatus !== 'disabled') {
    const result = await publishGithubEnvelopeOnly({
      tx: params.tx,
      deliveryId: params.deliveryId,
      payload: params.payload,
      publishIntegrationEventReceived: params.publishIntegrationEventReceived,
      connection,
      event: `installation.${action}`,
    });
    return {claimed: result.outcome === 'published-envelope', outcome: result.outcome};
  }
  const {claimed} = await params.recordDeliveryOnly({
    tx: params.tx,
    provider: GITHUB_SOURCE,
    deliveryId: params.deliveryId,
  });
  return {
    claimed,
    outcome: claimed ? 'installation-lifecycle' : 'duplicate-installation-lifecycle',
  };
}

const UNLINKED_INSTALLATION_ACTIONS = new Set(['created', 'new_permissions_accepted', 'unsuspend']);

async function deleteGithubUnlinkedInstallationForDeletedEvent(params: {
  tx: IntegrationTx;
  event: string;
  action: string | undefined;
  installationId: number;
}): Promise<void> {
  if (params.event !== 'installation' || params.action !== 'deleted') return;
  await deleteGithubUnlinkedInstallationByInstallationId(String(params.installationId), {
    tx: params.tx,
  });
}

async function recordUnknownGithubInstallation(params: {
  tx: IntegrationTx;
  installationId: number;
  event: string;
  action: string | undefined;
  payload: unknown;
}): Promise<void> {
  if (params.event !== 'installation') return;

  if (!params.action || !UNLINKED_INSTALLATION_ACTIONS.has(params.action)) return;

  const parsed = githubWebhookInstallationSchema.safeParse(params.payload);
  const details = parsed.success ? parsed.data : undefined;
  const installation = details?.installation;
  const account = installation?.account;
  const repositorySelection = installation?.repository_selection;
  if (!account || !repositorySelection) return;

  await upsertGithubUnlinkedInstallation(
    {
      installationId: String(params.installationId),
      accountLogin: account.login,
      accountType: account.type,
      repositorySelection,
      senderLogin: details?.sender?.login,
      requesterLogin: details?.requester?.login,
      lastAction: params.action,
    },
    {tx: params.tx},
  );
}

function logUnknownGithubInstallation(params: {
  deliveryId: string;
  installationId: number;
  event: string;
  action: string | undefined;
  payload: unknown;
}): void {
  const parsed = githubWebhookInstallationSchema.safeParse(params.payload);
  const details = parsed.success ? parsed.data : undefined;
  const logContext = {
    deliveryId: params.deliveryId,
    installationId: params.installationId,
    event: params.event,
    action: params.action,
    account: details?.installation?.account,
    sender: details?.sender,
    requester: details?.requester,
  };
  if (params.event === 'installation') {
    logger().warn(logContext, 'github webhook: unknown installation, dropping');
  } else {
    logger().info(logContext, 'github webhook: unknown installation, dropping');
  }
}

function normalizeRepositoryUpdates(
  event: string,
  action: string | undefined,
  payload: unknown,
): SourceRepositoryIdentity[] | undefined {
  if (event === 'repository' && action === 'renamed') {
    const parsed = githubRepositoryRenamedPayloadSchema.safeParse(payload);
    if (!parsed.success) return undefined;
    return [toSourceRepositoryIdentity(parsed.data.repository)];
  }

  if (event !== 'installation_repositories' || (action !== 'added' && action !== 'removed')) {
    return undefined;
  }

  const parsed = githubInstallationRepositoriesPayloadSchema.safeParse(payload);
  if (!parsed.success) return undefined;

  const removedRepositoryIds = new Set(
    parsed.data.repositories_removed.map((repository) => repository.id),
  );
  const repositories = parsed.data.repositories_added
    .filter((repository) => !removedRepositoryIds.has(repository.id))
    .map(toSourceRepositoryIdentity);
  return repositories.length > 0 ? repositories : undefined;
}

function toSourceRepositoryIdentity(repository: {
  id: number;
  name: string;
  owner: {login: string};
  default_branch: string;
}): SourceRepositoryIdentity {
  return {
    externalRepositoryId: buildProviderRepositoryId(GITHUB_SOURCE, String(repository.id)),
    owner: repository.owner.login,
    name: repository.name,
    defaultBranch: repository.default_branch,
  };
}

function shouldDeleteInstallationTokenSecret(event: string, action: string | undefined): boolean {
  return (
    event === 'installation' &&
    (action === 'deleted' || action === 'suspend' || action === 'new_permissions_accepted')
  );
}

function withInstallationTokenCleanup(
  result: HandleGithubEventResult,
  event: string,
  action: string | undefined,
  workspaceId: string,
  installationId: number,
): HandleGithubEventResult {
  if (!shouldDeleteInstallationTokenSecret(event, action)) return result;
  return {...result, installationTokenCleanup: {workspaceId, installationId}};
}

async function publishGithubPush(params: {
  tx: IntegrationTx;
  deliveryId: string;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  publishSourcePush: PublishSourcePushFn;
  eventPayload: GithubPushPayloadDto;
  rawPayload: unknown;
  connection: {
    id: string;
    workspaceId: string;
    slug: string;
    displayName: string;
  };
}): Promise<{outcome: HandleGithubEventOutcome}> {
  if (isBranchDeletion(params.eventPayload.after)) {
    const result = await params.publishIntegrationEventReceived({
      tx: params.tx,
      event: {
        provider: GITHUB_SOURCE,
        source: params.connection.slug,
        event: 'push',
        workspaceId: params.connection.workspaceId,
        connectionId: params.connection.id,
        connectionName: params.connection.displayName,
        deliveryId: params.deliveryId,
        receivedAt: new Date().toISOString(),
        payload: params.rawPayload,
      },
    });
    return {
      outcome: result.published ? 'published-push-envelope-only' : 'duplicate-push-envelope-only',
    };
  }

  const ref = stripRefsHeads(params.eventPayload.ref);
  const defaultBranch = params.eventPayload.repository.default_branch;
  const push: SourcePushPayload = {
    externalRepositoryId: buildProviderRepositoryId(
      GITHUB_SOURCE,
      String(params.eventPayload.repository.id),
    ),
    ref,
    headCommitSha: params.eventPayload.after,
    defaultBranch,
    isDefaultBranch: ref === defaultBranch,
  };
  const result = await params.publishSourcePush({
    tx: params.tx,
    provider: GITHUB_SOURCE,
    source: params.connection.slug,
    workspaceId: params.connection.workspaceId,
    connectionId: params.connection.id,
    connectionName: params.connection.displayName,
    deliveryId: params.deliveryId,
    receivedAt: new Date().toISOString(),
    rawPayload: params.rawPayload,
    push,
  });

  return {outcome: result.published ? 'published' : 'duplicate'};
}

async function publishGithubEnvelopeOnly(params: {
  tx: IntegrationTx;
  deliveryId: string;
  payload: unknown;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  connection: {id: string; workspaceId: string; slug: string; displayName: string};
  event: string;
}): Promise<{outcome: HandleGithubEventOutcome}> {
  const result = await params.publishIntegrationEventReceived({
    tx: params.tx,
    event: {
      provider: GITHUB_SOURCE,
      source: params.connection.slug,
      event: params.event,
      workspaceId: params.connection.workspaceId,
      connectionId: params.connection.id,
      connectionName: params.connection.displayName,
      deliveryId: params.deliveryId,
      receivedAt: new Date().toISOString(),
      payload: params.payload,
    },
  });
  return {outcome: result.published ? 'published-envelope' : 'duplicate-envelope'};
}

function stripRefsHeads(ref: string): string {
  return ref.startsWith(REFS_HEADS_PREFIX) ? ref.slice(REFS_HEADS_PREFIX.length) : ref;
}
