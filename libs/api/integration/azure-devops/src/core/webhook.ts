import {
  type AzureDevOpsPushResourceDto,
  type AzureDevOpsServiceHookEnvelopeDto,
  azureDevOpsEventRepositorySchema,
  azureDevOpsProviderKind,
  azureDevOpsPushEventName,
  azureDevOpsPushResourceSchema,
  isAzureDevOpsWebhookEventName,
} from '@shipfox/api-integration-azure-devops-dto';
import {
  asRecord,
  buildProviderRepositoryId,
  type IntegrationEventResource,
  type IntegrationTx,
  type PublishIntegrationEventReceivedFn,
  type PublishSourcePushFn,
  type RecordDeliveryOnlyFn,
  repositoryEventResource,
} from '@shipfox/api-integration-spi';
import type {AzureDevOpsIntegrationConnection} from './credentials.js';

const REFS_HEADS_PREFIX = 'refs/heads/';
const ZERO_OBJECT_ID_RE = /^0+$/;

export interface HandleAzureDevOpsWebhookParams {
  tx: IntegrationTx;
  connection: AzureDevOpsIntegrationConnection;
  envelope: AzureDevOpsServiceHookEnvelopeDto;
  rawPayload: unknown;
  receivedAt: string;
  publishSourcePush: PublishSourcePushFn;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
}

export type HandleAzureDevOpsWebhookOutcome =
  | 'published'
  | 'duplicate'
  | 'deleted'
  | 'recorded-only'
  | 'inactive-connection';

export async function handleAzureDevOpsWebhook(
  params: HandleAzureDevOpsWebhookParams,
): Promise<HandleAzureDevOpsWebhookOutcome> {
  const deliveryId = params.envelope.id;
  if (
    params.connection.lifecycleStatus !== 'active' ||
    !isAzureDevOpsWebhookEventName(params.envelope.eventType)
  ) {
    await params.recordDeliveryOnly({
      tx: params.tx,
      provider: azureDevOpsProviderKind,
      deliveryId,
      connectionId: params.connection.id,
    });
    return params.connection.lifecycleStatus === 'active' ? 'recorded-only' : 'inactive-connection';
  }

  if (params.envelope.eventType === azureDevOpsPushEventName) {
    const pushOutcome = await handlePush(params);
    if (pushOutcome !== null) return pushOutcome;
  }
  return await publishEvent(params);
}

/**
 * Publishes every ref a push updated as its own source push. One notification can carry several
 * refs (branches and tags pushed together). `publishSourcePush` writes both the typed push and
 * the generic event that triggers read, so each ref gets a payload narrowed to that ref, the way
 * GitHub sends one push event per ref, and its own delivery id so retries stay de-duplicated per
 * ref. Null when the payload cannot be a typed push.
 */
async function handlePush(
  params: HandleAzureDevOpsWebhookParams,
): Promise<HandleAzureDevOpsWebhookOutcome | null> {
  const parsed = azureDevOpsPushResourceSchema.safeParse(params.envelope.resource);
  if (!parsed.success || !parsed.data.repository.defaultBranch) return null;
  const resource = parsed.data;
  const updates = resource.refUpdates.filter(
    (update) => !ZERO_OBJECT_ID_RE.test(update.newObjectId),
  );
  // A ref whose new object id is all zeros was deleted; there is nothing to run for it.
  if (updates.length === 0) return 'deleted';

  let published = false;
  for (const update of updates) {
    const deliveryId =
      resource.refUpdates.length === 1
        ? params.envelope.id
        : `${params.envelope.id}:${update.name}`;
    const result = await publishRefUpdate(params, resource, update, deliveryId);
    published ||= result.published;
  }
  return published ? 'published' : 'duplicate';
}

function publishRefUpdate(
  params: HandleAzureDevOpsWebhookParams,
  resource: AzureDevOpsPushResourceDto,
  update: AzureDevOpsPushResourceDto['refUpdates'][number],
  deliveryId: string,
) {
  const repository = resource.repository;
  const externalRepositoryId = buildProviderRepositoryId(
    azureDevOpsProviderKind,
    `${repository.project.id}/${repository.id}`,
  );
  const ref = stripRefsHeads(update.name);
  const defaultBranch = stripRefsHeads(repository.defaultBranch ?? '');
  return params.publishSourcePush({
    tx: params.tx,
    provider: azureDevOpsProviderKind,
    source: params.connection.slug,
    workspaceId: params.connection.workspaceId,
    connectionId: params.connection.id,
    connectionName: params.connection.displayName,
    deliveryId,
    receivedAt: params.receivedAt,
    rawPayload: payloadForRef(params.rawPayload, resource.refUpdates.length, update),
    resource: repositoryEventResource({
      externalRepositoryId,
      fullName: `${repository.project.name}/${repository.name}`,
    }),
    push: {
      externalRepositoryId,
      ref,
      headCommitSha: update.newObjectId,
      defaultBranch,
      isDefaultBranch: ref === defaultBranch,
    },
  });
}

async function publishEvent(
  params: HandleAzureDevOpsWebhookParams,
): Promise<HandleAzureDevOpsWebhookOutcome> {
  const resource = eventResource(params.envelope);
  const result = await params.publishIntegrationEventReceived({
    tx: params.tx,
    event: {
      provider: azureDevOpsProviderKind,
      source: params.connection.slug,
      event: params.envelope.eventType,
      workspaceId: params.connection.workspaceId,
      connectionId: params.connection.id,
      connectionName: params.connection.displayName,
      deliveryId: params.envelope.id,
      receivedAt: params.receivedAt,
      ...(resource ? {resource} : {}),
      payload: params.rawPayload,
    },
  });
  return result.published ? 'published' : 'duplicate';
}

/**
 * The repository an event belongs to, so triggers can check a project's access. Pull-request
 * events carry it on the resource, comment events on the commented pull request, and build events
 * name the repository on the resource and its project only in `resourceContainers`.
 */
function eventResource(
  envelope: AzureDevOpsServiceHookEnvelopeDto,
): IntegrationEventResource | undefined {
  const candidates = [
    envelope.resource.repository,
    asRecord(envelope.resource.pullRequest)?.repository,
  ];
  const envelopeProjectId = envelope.resourceContainers?.project?.id;
  for (const candidate of candidates) {
    const parsed = azureDevOpsEventRepositorySchema.safeParse(candidate);
    if (!parsed.success) continue;
    const repository = parsed.data;
    const projectId = repository.project?.id ?? envelopeProjectId;
    if (!projectId) continue;
    return repositoryEventResource({
      externalRepositoryId: buildProviderRepositoryId(
        azureDevOpsProviderKind,
        `${projectId}/${repository.id}`,
      ),
      fullName: `${repository.project?.name ?? projectId}/${repository.name ?? repository.id}`,
    });
  }
  return undefined;
}

/** The raw notification with `resource.refUpdates` narrowed to one ref; unchanged for one ref. */
function payloadForRef(
  rawPayload: unknown,
  refCount: number,
  update: AzureDevOpsPushResourceDto['refUpdates'][number],
): unknown {
  const envelope = asRecord(rawPayload);
  const resource = asRecord(envelope?.resource);
  if (refCount === 1 || !envelope || !resource) return rawPayload;
  // Keep the provider's own entry, with any fields the schema does not model.
  const rawUpdates = Array.isArray(resource.refUpdates) ? resource.refUpdates : [];
  const rawUpdate = rawUpdates.find((entry) => asRecord(entry)?.name === update.name) ?? update;
  return {...envelope, resource: {...resource, refUpdates: [rawUpdate]}};
}

function stripRefsHeads(ref: string): string {
  return ref.startsWith(REFS_HEADS_PREFIX) ? ref.slice(REFS_HEADS_PREFIX.length) : ref;
}
