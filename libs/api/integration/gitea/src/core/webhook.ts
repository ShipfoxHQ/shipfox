import {
  buildProviderRepositoryId,
  type GetIntegrationConnectionByIdFn,
  type IntegrationTx,
  type PublishSourcePushFn,
  type RecordDeliveryOnlyFn,
  type SourcePushPayload,
} from '@shipfox/api-integration-core-dto';
import {type GiteaPushPayloadDto, giteaProviderKind} from '@shipfox/api-integration-gitea-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {getGiteaConnectionByOrg} from '#db/connections.js';

const REFS_HEADS_PREFIX = 'refs/heads/';
// Gitea sends a `push` webhook for a branch deletion with `after` set to this all-zero SHA.
const DELETED_BRANCH_SHA = '0'.repeat(40);

export interface HandleGiteaPushParams {
  tx: IntegrationTx;
  deliveryId: string;
  payload: GiteaPushPayloadDto;
  publishSourcePush: PublishSourcePushFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
}

export type HandleGiteaPushOutcome = 'published' | 'duplicate' | 'deleted' | 'unknown-org';

function isBranchDeletion(after: string): boolean {
  return after === DELETED_BRANCH_SHA;
}

export async function handleGiteaPush(
  params: HandleGiteaPushParams,
): Promise<{outcome: HandleGiteaPushOutcome}> {
  // Dropping deletes before `publishSourcePush` avoids project and trigger fan-out.
  if (isBranchDeletion(params.payload.after)) {
    return {outcome: 'deleted'};
  }

  const owner = params.payload.repository.owner.username;
  // Gitea org routes are case-insensitive, and the connect flow stores them lower-cased.
  const giteaConnection = await getGiteaConnectionByOrg(owner.toLowerCase(), {tx: params.tx});
  if (!giteaConnection) {
    logger().warn(
      {deliveryId: params.deliveryId, org: owner},
      'gitea webhook: unknown org, dropping',
    );
    await params.recordDeliveryOnly({
      tx: params.tx,
      provider: giteaProviderKind,
      deliveryId: params.deliveryId,
    });
    return {outcome: 'unknown-org'};
  }

  const connection = await params.getIntegrationConnectionById(giteaConnection.connectionId, {
    tx: params.tx,
  });
  if (!connection) {
    logger().warn(
      {deliveryId: params.deliveryId, org: owner, connectionId: giteaConnection.connectionId},
      'gitea webhook: org has no connection, dropping',
    );
    await params.recordDeliveryOnly({
      tx: params.tx,
      provider: giteaProviderKind,
      deliveryId: params.deliveryId,
    });
    return {outcome: 'unknown-org'};
  }

  const ref = stripRefsHeads(params.payload.ref);
  const defaultBranch = params.payload.repository.default_branch;
  const push: SourcePushPayload = {
    // Match the source-control adapter's owner/name repository id.
    externalRepositoryId: buildProviderRepositoryId(
      giteaProviderKind,
      `${owner}/${params.payload.repository.name}`,
    ),
    ref,
    headCommitSha: params.payload.after,
    defaultBranch,
    isDefaultBranch: ref === defaultBranch,
  };
  const result = await params.publishSourcePush({
    tx: params.tx,
    provider: giteaProviderKind,
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
