import type {SourcePushPayload} from '@shipfox/api-integration-core-dto';
import {DEBUG_REPOSITORIES} from '#core/source-control.js';

const DEBUG_PROVIDER = 'debug';
// `platform` is the debug fixture that carries workflow files (see DEBUG_FILES); `api` and
// `runner` ship none, so only `platform` needs a re-sync.
const DEBUG_RESYNC_REPOSITORY = 'platform';
// Clearly-synthetic commit marker, not a branch name. Debug content is ref-independent, so
// this never points at a real commit. A stable value keeps the definition-sync workflow id
// (`definition-sync:<projectId>:<sha>`) stable across boots, so Temporal's ALLOW_DUPLICATE
// re-runs the sync each boot once the prior run closes. It does not guarantee exactly-once
// across concurrent replicas, but duplicate runs are idempotent and fine for a dev provider.
const DEBUG_RESYNC_COMMIT = 'debug-startup-resync';

export interface DebugStartupResyncConnection {
  id: string;
  workspaceId: string;
}

export interface PublishDebugSourceCommitPushedParams {
  provider: string;
  workspaceId: string;
  connectionId: string;
  deliveryId: string;
  receivedAt: string;
  push: SourcePushPayload;
}

export interface DebugStartupResyncDeps {
  listConnections: () => Promise<DebugStartupResyncConnection[]>;
  publishSourceCommitPushed: (params: PublishDebugSourceCommitPushedParams) => Promise<void>;
}

/**
 * Emits one `INTEGRATION_SOURCE_COMMIT_PUSHED` for the debug `platform` repo on its default
 * branch, for every connection returned by `listConnections`. This re-drives the definitions
 * sync so debug workflow fixtures are re-applied. All I/O is injected so the debug package
 * stays free of core's database wiring.
 */
export async function emitDebugStartupResync(deps: DebugStartupResyncDeps): Promise<void> {
  const connections = await deps.listConnections();
  if (connections.length === 0) return;

  const repository = DEBUG_REPOSITORIES.find((repo) => repo.name === DEBUG_RESYNC_REPOSITORY);
  if (!repository) return;
  const externalRepositoryId = repository.externalRepositoryId;

  for (const connection of connections) {
    await deps.publishSourceCommitPushed({
      provider: DEBUG_PROVIDER,
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      // Unique per emission for traceable logs; the writer skips delivery-dedup, so a stable
      // id would make every boot's events indistinguishable.
      deliveryId: `debug-startup-resync:${crypto.randomUUID()}`,
      receivedAt: new Date().toISOString(),
      push: {
        externalRepositoryId,
        ref: repository.defaultBranch,
        headCommitSha: DEBUG_RESYNC_COMMIT,
        defaultBranch: repository.defaultBranch,
        isDefaultBranch: true,
      },
    });
  }
}
