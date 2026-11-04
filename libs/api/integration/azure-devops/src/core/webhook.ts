import {
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

/** Publishes a push as a typed source-control push. Null when the payload cannot be one. */
async function handlePush(
  params: HandleAzureDevOpsWebhookParams,
): Promise<HandleAzureDevOpsWebhookOutcome | null> {
  const parsed = azureDevOpsPushResourceSchema.safeParse(params.envelope.resource);
  if (!parsed.success) return null;
  const resource = parsed.data;
  const update = resource.refUpdates[0];
  const defaultBranchRef = resource.repository.defaultBranch;
  if (!update || !defaultBranchRef) return null;
  // A push that sets the new object id to all zeros deleted the ref; there is nothing to run.
  if (ZERO_OBJECT_ID_RE.test(update.newObjectId)) return 'deleted';

  const repository = resource.repository;
  const externalRepositoryId = buildProviderRepositoryId(
    azureDevOpsProviderKind,
    `${repository.project.id}/${repository.id}`,
  );
  const ref = stripRefsHeads(update.name);
  const defaultBranch = stripRefsHeads(defaultBranchRef);
  const result = await params.publishSourcePush({
    tx: params.tx,
    provider: azureDevOpsProviderKind,
    source: params.connection.slug,
    workspaceId: params.connection.workspaceId,
    connectionId: params.connection.id,
    connectionName: params.connection.displayName,
    deliveryId: params.envelope.id,
    receivedAt: params.receivedAt,
    rawPayload: params.rawPayload,
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
  return result.published ? 'published' : 'duplicate';
}

async function publishEvent(
  params: HandleAzureDevOpsWebhookParams,
): Promise<HandleAzureDevOpsWebhookOutcome> {
  const resource = eventResource(params.envelope.resource);
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
 * events carry it on the resource; comment events carry it on the commented pull request.
 */
function eventResource(resource: Record<string, unknown>): IntegrationEventResource | undefined {
  const candidates = [resource.repository, asRecord(resource.pullRequest)?.repository];
  for (const candidate of candidates) {
    const parsed = azureDevOpsEventRepositorySchema.safeParse(candidate);
    if (!parsed.success) continue;
    return repositoryEventResource({
      externalRepositoryId: buildProviderRepositoryId(
        azureDevOpsProviderKind,
        `${parsed.data.project.id}/${parsed.data.id}`,
      ),
      fullName: `${parsed.data.project.name}/${parsed.data.name}`,
    });
  }
  return undefined;
}

function stripRefsHeads(ref: string): string {
  return ref.startsWith(REFS_HEADS_PREFIX) ? ref.slice(REFS_HEADS_PREFIX.length) : ref;
}
