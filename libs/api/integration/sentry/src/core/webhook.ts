import type {
  GetIntegrationConnectionByIdFn,
  IntegrationTx,
  PublishIntegrationEventReceivedFn,
  RecordDeliveryOnlyFn,
  SentryIssuePayload,
  UpdateIntegrationConnectionLifecycleStatusFn,
} from '@shipfox/api-integration-core-dto';
import type {SentryIssueWebhookDto} from '@shipfox/api-integration-sentry-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {SentryApiClient} from '#api/client.js';
import {
  SentryConnectionNotFoundError,
  SentryInstallationDeletedError,
  SentryInstallationNotFoundError,
  SentryInstallationUnclaimedError,
  SentryIntegrationProviderError,
} from '#core/errors.js';
import {verifyAndPersistUnclaimedInstallation} from '#core/install.js';
import {
  getSentryInstallationByInstallationUuid,
  markSentryInstallationDeleted,
  type SentryInstallation,
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
// publish against (unknown/deleted installation, or an install not yet claimed
// into a workspace); the webhook layer records-and-drops those. Dedup of an
// already-seen delivery is handled inside publishIntegrationEventReceived.
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
  // A verified-but-unclaimed install has no workspace yet, so there is nothing to
  // publish an event against. This is the pre-claim drop window (counted/logged).
  if (!installation.connectionId) {
    throw new SentryInstallationUnclaimedError(installationUuid);
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
      provider: SENTRY_SOURCE,
      source: connection.slug,
      event: `issue.${params.payload.action}`,
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      connectionName: connection.displayName,
      deliveryId: params.deliveryId,
      receivedAt: new Date().toISOString(),
      payload: normalizeIssuePayload(params.payload),
    },
  });
}

export interface HandleSentryInstallationCreatedParams {
  deliveryId: string;
  installationUuid: string;
  // From the signed payload; the webhook is authoritative so the slug is trusted
  // without a getInstallation round-trip. The code is the single-use grant.
  orgSlug: string | undefined;
  code: string | undefined;
  sentry: SentryApiClient;
  verifyInstall: boolean;
  getSentryInstallation: (input: {
    installationUuid: string;
  }) => Promise<SentryInstallation | undefined>;
  // Persists the verified-unclaimed row and records the delivery in one short
  // transaction, returning the persisted row.
  persistUnclaimedAndRecordDelivery: (input: {
    installationUuid: string;
    orgSlug: string;
    codeHash: string;
    deliveryId: string;
  }) => Promise<SentryInstallation>;
  // Records the delivery for dedup without persisting an install (reconcile/no-op,
  // missing code, or exchange failure → record-and-drop).
  recordDelivery: (deliveryId: string) => Promise<void>;
}

/**
 * The authoritative `installation.created` path. Whichever of webhook or browser
 * arrives first exchanges the single-use code and persists a verified-unclaimed
 * row; the other reconciles. Idempotent on the installation uuid. The exchange
 * runs outside any DB transaction; a short transaction wraps only persist +
 * delivery record. On an exchange failure the delivery is record-and-dropped
 * (204) — the browser may still win, or the code expired. Never logs the raw code.
 */
export async function handleSentryInstallationCreated(
  params: HandleSentryInstallationCreatedParams,
): Promise<void> {
  const existing = await params.getSentryInstallation({installationUuid: params.installationUuid});
  if (existing) {
    logger().debug(
      {deliveryId: params.deliveryId, installationUuid: params.installationUuid},
      'sentry webhook: installation.created for an existing row, reconciling',
    );
    await params.recordDelivery(params.deliveryId);
    return;
  }

  if (!params.code) {
    logger().warn(
      {deliveryId: params.deliveryId, installationUuid: params.installationUuid},
      'sentry webhook: installation.created without an authorization code, dropping',
    );
    await params.recordDelivery(params.deliveryId);
    return;
  }

  try {
    await verifyAndPersistUnclaimedInstallation({
      sentry: params.sentry,
      installationUuid: params.installationUuid,
      code: params.code,
      orgSlug: params.orgSlug,
      verifyInstall: params.verifyInstall,
      persistVerifiedUnclaimedInstallation: ({installationUuid, orgSlug, codeHash}) =>
        params.persistUnclaimedAndRecordDelivery({
          installationUuid,
          orgSlug,
          codeHash,
          deliveryId: params.deliveryId,
        }),
    });
  } catch (error) {
    if (error instanceof SentryIntegrationProviderError) {
      // The Sentry exchange (or org-slug lookup) failed, so we never durably
      // spent the code on a row we own. `reason` distinguishes a transient/expected
      // drop (access-denied: the code was already spent, e.g. the browser won) from
      // a likely misconfiguration (a bad client id/secret/slug fails every install)
      // so log-based alerting can fire on the sustained case. Never logs the raw code.
      logger().warn(
        {
          deliveryId: params.deliveryId,
          installationUuid: params.installationUuid,
          reason: error.reason,
          err: error,
        },
        'sentry webhook: installation.created exchange failed, dropping',
      );
    } else {
      // The exchange succeeded (the single-use code is now spent) but the persist
      // transaction failed, so no row exists and Sentry will not usefully
      // re-deliver — the install is stranded until a reinstall mints a fresh uuid.
      // Log at error so alerting catches it; still record-and-drop because retrying
      // a spent code cannot recover the row. Never logs the raw code.
      logger().error(
        {deliveryId: params.deliveryId, installationUuid: params.installationUuid, err: error},
        'sentry webhook: installation.created persisted nothing after a successful exchange, install stranded until reinstall',
      );
    }
    await params.recordDelivery(params.deliveryId);
  }
}

export interface HandleSentryInstallationDeletedParams {
  tx: IntegrationTx;
  deliveryId: string;
  installationUuid: string;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  updateConnectionLifecycleStatus: UpdateIntegrationConnectionLifecycleStatusFn;
}

// Tombstones the install and disables its connection if one exists. An unknown
// uuid (never installed, or reinstall mints a fresh uuid) only records the
// delivery: there is no tombstone row to write. Runs entirely in the caller's
// transaction — no exchange is needed.
export async function handleSentryInstallationDeleted(
  params: HandleSentryInstallationDeletedParams,
): Promise<void> {
  const installation = await markSentryInstallationDeleted(
    {installationUuid: params.installationUuid},
    {tx: params.tx},
  );
  if (installation?.connectionId) {
    await params.updateConnectionLifecycleStatus(
      {id: installation.connectionId, lifecycleStatus: 'disabled'},
      {tx: params.tx},
    );
  }

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
