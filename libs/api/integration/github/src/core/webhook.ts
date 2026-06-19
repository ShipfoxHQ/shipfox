import {
  buildProviderRepositoryId,
  type GetIntegrationConnectionByIdFn,
  type IntegrationTx,
  type PublishSourcePushFn,
  type RecordDeliveryOnlyFn,
  type SourcePushPayload,
} from '@shipfox/api-integration-core-dto';
import type {GithubPushPayloadDto} from '@shipfox/api-integration-github-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {getGithubInstallationByInstallationId} from '#db/installations.js';

const REFS_HEADS_PREFIX = 'refs/heads/';
const GITHUB_SOURCE = 'github';
// GitHub sends a `push` webhook for a branch deletion with `after` set to this all-zero SHA.
const DELETED_BRANCH_SHA = '0'.repeat(40);

export interface HandleGithubPushParams {
  tx: IntegrationTx;
  deliveryId: string;
  payload: GithubPushPayloadDto;
  publishSourcePush: PublishSourcePushFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
}

export type HandleGithubPushOutcome =
  | 'published'
  | 'duplicate'
  | 'deleted'
  | 'unknown-installation'
  | 'no-installation-id';

function isBranchDeletion(after: string): boolean {
  return after === DELETED_BRANCH_SHA;
}

export async function handleGithubPush(
  params: HandleGithubPushParams,
): Promise<{outcome: HandleGithubPushOutcome}> {
  // A branch deletion is not a commit. Dropping it here, before `publishSourcePush`,
  // emits neither the typed source-commit event (projects) nor the generic
  // `INTEGRATION_EVENT_RECEIVED` envelope (triggers), so a deletion triggers nothing.
  if (isBranchDeletion(params.payload.after)) {
    return {outcome: 'deleted'};
  }

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
  const push: SourcePushPayload = {
    externalRepositoryId: buildProviderRepositoryId(
      GITHUB_SOURCE,
      String(params.payload.repository.id),
    ),
    ref,
    headCommitSha: params.payload.after,
    defaultBranch,
    isDefaultBranch: ref === defaultBranch,
  };
  const result = await params.publishSourcePush({
    tx: params.tx,
    provider: GITHUB_SOURCE,
    workspaceId: connection.workspaceId,
    connectionId: connection.id,
    deliveryId: params.deliveryId,
    receivedAt: new Date().toISOString(),
    push,
  });

  return {outcome: result.published ? 'published' : 'duplicate'};
}

function stripRefsHeads(ref: string): string {
  return ref.startsWith(REFS_HEADS_PREFIX) ? ref.slice(REFS_HEADS_PREFIX.length) : ref;
}
