import {
  buildProviderRepositoryId,
  type IntegrationConnection,
  type IntegrationRepositoryPushedEvent,
} from '@shipfox/api-integration-core-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {getGithubInstallationByInstallationId} from '#db/installations.js';

const REFS_HEADS_PREFIX = 'refs/heads/';
const GITHUB_PROVIDER = 'github';

// `Tx` is loose to avoid a static dependency on @shipfox/api-integration-core,
// which already depends on this package. The route handler receives the tx
// from `coreDb().transaction(...)` and only passes it through.
// biome-ignore lint/suspicious/noExplicitAny: cross-package tx without cyclic dep
type Tx = any;

export type PublishRepositoryPushedFn = (params: {
  tx: Tx;
  event: IntegrationRepositoryPushedEvent;
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

export interface GithubPushPayload {
  ref: string;
  after: string;
  repository: {
    id: number;
    default_branch: string;
  };
  installation?: {id: number} | undefined;
}

export interface HandleGithubPushParams {
  tx: Tx;
  deliveryId: string;
  payload: GithubPushPayload;
  publishRepositoryPushed: PublishRepositoryPushedFn;
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
      provider: GITHUB_PROVIDER,
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
      provider: GITHUB_PROVIDER,
      deliveryId: params.deliveryId,
    });
    return {outcome: 'unknown-installation'};
  }

  const ref = stripRefsHeads(params.payload.ref);
  const defaultBranch = params.payload.repository.default_branch;
  const result = await params.publishRepositoryPushed({
    tx: params.tx,
    event: {
      provider: GITHUB_PROVIDER,
      connectionId: connection.id,
      workspaceId: connection.workspaceId,
      externalRepositoryId: buildProviderRepositoryId(
        GITHUB_PROVIDER,
        String(params.payload.repository.id),
      ),
      ref,
      headCommitSha: params.payload.after,
      defaultBranch,
      isDefaultBranch: ref === defaultBranch,
      deliveryId: params.deliveryId,
      receivedAt: new Date().toISOString(),
    },
  });

  return {outcome: result.published ? 'published' : 'duplicate'};
}

function stripRefsHeads(ref: string): string {
  return ref.startsWith(REFS_HEADS_PREFIX) ? ref.slice(REFS_HEADS_PREFIX.length) : ref;
}
