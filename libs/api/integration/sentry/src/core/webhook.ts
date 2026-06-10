import type {
  IntegrationConnection,
  IntegrationConnectionLifecycleStatus,
  IntegrationEventReceivedEvent,
  SentryIssuePayload,
} from '@shipfox/api-integration-core-dto';
import type {SentryIssueWebhookDto} from '@shipfox/api-integration-sentry-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {
  getSentryInstallationByInstallationUuid,
  markSentryInstallationDeleted,
} from '#db/installations.js';

const SENTRY_SOURCE = 'sentry';
const DEFAULT_ISSUE_TITLE = 'Sentry issue';
const DELETED_STATUS = 'deleted';

// biome-ignore lint/suspicious/noExplicitAny: cross-package tx without cyclic dep
type Tx = any;

export type PublishIntegrationEventReceivedFn = (params: {
  tx: Tx;
  event: IntegrationEventReceivedEvent;
}) => Promise<{published: boolean}>;

export type RecordDeliveryOnlyFn = (params: {
  tx: Tx;
  provider: string;
  deliveryId: string;
}) => Promise<void>;

export type GetIntegrationConnectionByIdFn = (
  id: string,
  options?: {tx?: Tx},
) => Promise<IntegrationConnection | undefined>;

export type UpdateConnectionLifecycleStatusFn = (
  params: {id: string; lifecycleStatus: IntegrationConnectionLifecycleStatus},
  options?: {tx?: Tx},
) => Promise<unknown>;

export interface HandleSentryIssueEventParams {
  tx: Tx;
  deliveryId: string;
  payload: SentryIssueWebhookDto;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
}

export type HandleSentryIssueOutcome =
  | 'published'
  | 'duplicate'
  | 'unknown-installation'
  | 'installation-deleted'
  | 'unknown-connection';

export async function handleSentryIssueEvent(
  params: HandleSentryIssueEventParams,
): Promise<{outcome: HandleSentryIssueOutcome}> {
  const installationUuid = params.payload.installation.uuid;

  const installation = await getSentryInstallationByInstallationUuid(installationUuid, {
    tx: params.tx,
  });
  if (!installation) {
    logger().warn(
      {deliveryId: params.deliveryId, installationUuid},
      'sentry webhook: unknown installation, dropping',
    );
    await recordDrop(params);
    return {outcome: 'unknown-installation'};
  }
  if (installation.status === DELETED_STATUS) {
    logger().warn(
      {deliveryId: params.deliveryId, installationUuid},
      'sentry webhook: installation is deleted, dropping',
    );
    await recordDrop(params);
    return {outcome: 'installation-deleted'};
  }

  const connection = await params.getIntegrationConnectionById(installation.connectionId, {
    tx: params.tx,
  });
  if (!connection) {
    logger().warn(
      {deliveryId: params.deliveryId, installationUuid, connectionId: installation.connectionId},
      'sentry webhook: installation has no connection, dropping',
    );
    await recordDrop(params);
    return {outcome: 'unknown-connection'};
  }

  const result = await params.publishIntegrationEventReceived({
    tx: params.tx,
    event: {
      source: SENTRY_SOURCE,
      event: `issue.${params.payload.action}`,
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      deliveryId: params.deliveryId,
      receivedAt: new Date().toISOString(),
      payload: normalizeIssuePayload(params.payload),
    },
  });

  return {outcome: result.published ? 'published' : 'duplicate'};
}

export interface HandleSentryInstallationLifecycleParams {
  tx: Tx;
  deliveryId: string;
  action: 'created' | 'deleted';
  installationUuid: string;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  updateConnectionLifecycleStatus: UpdateConnectionLifecycleStatusFn;
}

export type HandleSentryInstallationOutcome = 'recorded' | 'disabled';

export async function handleSentryInstallationLifecycle(
  params: HandleSentryInstallationLifecycleParams,
): Promise<{outcome: HandleSentryInstallationOutcome}> {
  if (params.action === 'deleted') {
    const installation = await markSentryInstallationDeleted(
      {installationUuid: params.installationUuid},
      {tx: params.tx},
    );
    if (installation) {
      await params.updateConnectionLifecycleStatus(
        {id: installation.connectionId, lifecycleStatus: 'disabled'},
        {tx: params.tx},
      );
      await params.recordDeliveryOnly({
        tx: params.tx,
        provider: SENTRY_SOURCE,
        deliveryId: params.deliveryId,
      });
      return {outcome: 'disabled'};
    }
  }

  // The connect flow owns row creation; early lifecycle webhooks should not create
  // partial installations from an unauthenticated provider callback.
  await params.recordDeliveryOnly({
    tx: params.tx,
    provider: SENTRY_SOURCE,
    deliveryId: params.deliveryId,
  });
  return {outcome: 'recorded'};
}

// A raw Sentry `ignored` action is normalized to `archived` before validation,
// so legacy ignore events still fire `issue.archived` workflows.
export function normalizeSentryIssueAction(parsedJson: unknown): unknown {
  if (typeof parsedJson !== 'object' || parsedJson === null) return parsedJson;
  const obj = parsedJson as {action?: unknown};
  if (obj.action === 'ignored') {
    return {...obj, action: 'archived'};
  }
  return parsedJson;
}

function normalizeIssuePayload(payload: SentryIssueWebhookDto): SentryIssuePayload {
  const issue = payload.data.issue;
  return {
    action: payload.action,
    issueId: issue.id,
    shortId: issue.shortId ?? null,
    title: issue.title ?? DEFAULT_ISSUE_TITLE,
    culprit: issue.culprit ?? null,
    level: issue.level ?? null,
    status: issue.status ?? null,
    platform: issue.platform ?? null,
    webUrl: issue.web_url ?? null,
    issueUrl: issue.url ?? null,
    projectUrl: issue.project_url ?? null,
    firstSeenAt: issue.firstSeen ?? null,
    lastSeenAt: issue.lastSeen ?? null,
  };
}

function recordDrop(params: {
  tx: Tx;
  deliveryId: string;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
}): Promise<void> {
  return params.recordDeliveryOnly({
    tx: params.tx,
    provider: SENTRY_SOURCE,
    deliveryId: params.deliveryId,
  });
}
