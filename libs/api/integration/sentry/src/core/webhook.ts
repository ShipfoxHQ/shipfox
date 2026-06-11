import type {
  GetIntegrationConnectionByIdFn,
  IntegrationTx,
  PublishIntegrationEventReceivedFn,
  RecordDeliveryOnlyFn,
  SentryIssuePayload,
  UpdateIntegrationConnectionLifecycleStatusFn,
} from '@shipfox/api-integration-core-dto';
import type {SentryIssueWebhookDto} from '@shipfox/api-integration-sentry-dto';
import {
  SentryConnectionNotFoundError,
  SentryInstallationDeletedError,
  SentryInstallationNotFoundError,
} from '#core/errors.js';
import {
  getSentryInstallationByInstallationUuid,
  markSentryInstallationDeleted,
} from '#db/installations.js';

const SENTRY_SOURCE = 'sentry';
const DEFAULT_ISSUE_TITLE = 'Sentry issue';
const DELETED_STATUS = 'deleted';

export interface HandleSentryIssueEventParams {
  tx: IntegrationTx;
  deliveryId: string;
  payload: SentryIssueWebhookDto;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
}

// Publishes the mapped event for a verified issue delivery. Throws a typed
// SentryIssueDroppedError subclass when the delivery references state we cannot
// publish against (unknown/deleted installation, missing connection); the webhook
// layer records-and-drops those. Dedup of an already-seen delivery is handled
// inside publishIntegrationEventReceived.
export async function handleSentryIssueEvent(params: HandleSentryIssueEventParams): Promise<void> {
  const installationUuid = params.payload.installation.uuid;

  const installation = await getSentryInstallationByInstallationUuid(installationUuid, {
    tx: params.tx,
  });
  if (!installation) {
    throw new SentryInstallationNotFoundError(installationUuid);
  }
  if (installation.status === DELETED_STATUS) {
    throw new SentryInstallationDeletedError(installationUuid);
  }

  const connection = await params.getIntegrationConnectionById(installation.connectionId, {
    tx: params.tx,
  });
  if (!connection) {
    throw new SentryConnectionNotFoundError(installation.connectionId);
  }

  await params.publishIntegrationEventReceived({
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
}

export interface HandleSentryInstallationLifecycleParams {
  tx: IntegrationTx;
  deliveryId: string;
  action: 'created' | 'deleted';
  installationUuid: string;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  updateConnectionLifecycleStatus: UpdateIntegrationConnectionLifecycleStatusFn;
}

export async function handleSentryInstallationLifecycle(
  params: HandleSentryInstallationLifecycleParams,
): Promise<void> {
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
    }
  }

  // Every delivery is recorded for dedup. The connect flow owns row creation, so
  // an early lifecycle webhook with no matching row is recorded without creating a
  // partial installation from an unauthenticated provider callback.
  await params.recordDeliveryOnly({
    tx: params.tx,
    provider: SENTRY_SOURCE,
    deliveryId: params.deliveryId,
  });
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
