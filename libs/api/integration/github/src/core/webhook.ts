import {
  buildProviderRepositoryId,
  type GithubPushPayload,
  type IntegrationConnection,
  type IntegrationEventReceivedEvent,
} from '@shipfox/api-integration-core-dto';
import type {GithubPushPayloadDto} from '@shipfox/api-integration-github-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {getGithubInstallationByInstallationId} from '#db/installations.js';

const REFS_HEADS_PREFIX = 'refs/heads/';
const GITHUB_SOURCE = 'github';
const PUSH_EVENT = 'push';

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

export interface HandleGithubPushParams {
  tx: Tx;
  deliveryId: string;
  payload: GithubPushPayloadDto;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
}

export type HandleGithubPushOutcome =
  | 'published'
  | 'duplicate'
  | 'unknown-installation'
  | 'no-installation-id';

export async function handleGithubPush(
  params: HandleGithubPushParams,
): Promise<{outcome: HandleGithubPushOutcome}> {
  const installationId = params.payload.installation?.id;
  if (installationId === undefined) {
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
    return {outcome: 'unknown-installation'};
  }

  const ref = stripRefsHeads(params.payload.ref);
  const defaultBranch = params.payload.repository.default_branch;
  const pushPayload: GithubPushPayload = {
    externalRepositoryId: buildProviderRepositoryId(
      GITHUB_SOURCE,
      String(params.payload.repository.id),
    ),
    ref,
    headCommitSha: params.payload.after,
    defaultBranch,
    isDefaultBranch: ref === defaultBranch,
  };
  const result = await params.publishIntegrationEventReceived({
    tx: params.tx,
    event: {
      source: GITHUB_SOURCE,
      event: PUSH_EVENT,
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      deliveryId: params.deliveryId,
      receivedAt: new Date().toISOString(),
      payload: pushPayload,
    },
  });

  return {outcome: result.published ? 'published' : 'duplicate'};
}

function stripRefsHeads(ref: string): string {
  return ref.startsWith(REFS_HEADS_PREFIX) ? ref.slice(REFS_HEADS_PREFIX.length) : ref;
}
