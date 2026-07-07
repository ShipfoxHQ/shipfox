import {
  buildProviderRepositoryId,
  type GetIntegrationConnectionByIdFn,
  type IntegrationTx,
  type PublishIntegrationEventReceivedFn,
  type PublishSourcePushFn,
  type RecordDeliveryOnlyFn,
  type SourcePushPayload,
} from '@shipfox/api-integration-core-dto';
import {
  type GithubPushPayloadDto,
  githubPushPayloadSchema,
  githubWebhookActionSchema,
  githubWebhookInstallationSchema,
} from '@shipfox/api-integration-github-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {getGithubInstallationByInstallationId} from '#db/installations.js';

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
  publishSourcePush: PublishSourcePushFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  deleteInstallationTokenSecret?:
    | ((params: {workspaceId: string; installationId: number}) => Promise<unknown>)
    | undefined;
}

export type HandleGithubEventOutcome =
  | 'published'
  | 'duplicate'
  | 'published-envelope'
  | 'duplicate-envelope'
  | 'published-push-envelope-only'
  | 'duplicate-push-envelope-only'
  | 'unknown-installation'
  | 'missing-connection'
  | 'inactive-connection'
  | 'no-installation-id';

function isBranchDeletion(after: string): boolean {
  return after === DELETED_BRANCH_SHA;
}

export async function handleGithubEvent(
  params: HandleGithubEventParams,
): Promise<{outcome: HandleGithubEventOutcome}> {
  const actionEnvelope = githubWebhookActionSchema.safeParse(params.payload);
  const action = actionEnvelope.success ? actionEnvelope.data.action : undefined;
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

  const installation = await getGithubInstallationByInstallationId(String(installationId), {
    tx: params.tx,
  });
  if (!installation) {
    logger().warn(
      {deliveryId: params.deliveryId, installationId},
      'github webhook: unknown installation, dropping',
    );
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

  if (connection.lifecycleStatus !== 'active') {
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
    return {outcome: 'inactive-connection'};
  }

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
  const result = await publishGithubEnvelopeOnly({
    tx: params.tx,
    deliveryId: params.deliveryId,
    payload: params.payload,
    publishIntegrationEventReceived: params.publishIntegrationEventReceived,
    connection,
    event: eventName,
  });
  if (result.outcome === 'published-envelope') {
    await deleteInstallationTokenSecretBestEffort({
      deleteInstallationTokenSecret: params.deleteInstallationTokenSecret,
      event: params.event,
      action,
      deliveryId: params.deliveryId,
      workspaceId: connection.workspaceId,
      installationId,
    });
  }
  return result;
}

function shouldDeleteInstallationTokenSecret(event: string, action: string | undefined): boolean {
  return event === 'installation' && (action === 'deleted' || action === 'suspend');
}

async function deleteInstallationTokenSecretBestEffort(params: {
  deleteInstallationTokenSecret:
    | ((params: {workspaceId: string; installationId: number}) => Promise<unknown>)
    | undefined;
  event: string;
  action: string | undefined;
  deliveryId: string;
  workspaceId: string;
  installationId: number;
}): Promise<void> {
  if (!shouldDeleteInstallationTokenSecret(params.event, params.action)) return;

  try {
    await params.deleteInstallationTokenSecret?.({
      workspaceId: params.workspaceId,
      installationId: params.installationId,
    });
  } catch (error) {
    logger().warn(
      {
        deliveryId: params.deliveryId,
        installationId: params.installationId,
        workspaceId: params.workspaceId,
        error,
      },
      'github webhook installation token cleanup failed',
    );
  }
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
