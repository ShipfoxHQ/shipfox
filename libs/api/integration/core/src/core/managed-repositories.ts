import {MANAGED_VCS_PROVIDER} from '@shipfox/api-integration-managed-vcs-dto';
import {parseProviderRepositoryId} from '@shipfox/api-integration-spi';
import {resolveUniqueConnectionSlug, upsertIntegrationConnection} from '#db/connections.js';
import {db} from '#db/db.js';
import {retryConnectionSlugCollision} from '#providers/connection-slug.js';
import {
  ConfigCommitRefusedError,
  ManagedProjectConflictError,
  ManagedSeedFileRefusedError,
} from './errors.js';

export const MANAGED_CONNECTION_SLUG = 'shipfox-managed';

export interface CreateManagedProjectRepositoryParams {
  workspaceId: string;
  projectId: string;
  files?: ReadonlyArray<{path: string; content: string}> | undefined;
}

/**
 * Creates the repository of a project. The first one in a workspace also creates its hidden
 * connection, which every managed repository of the workspace shares.
 */
export async function createManagedProjectRepository(
  params: CreateManagedProjectRepositoryParams,
): Promise<{connectionId: string; externalRepositoryId: string}> {
  const managed = await import('@shipfox/api-integration-managed-vcs');

  // The repository comes first, so a refused request leaves no connection behind.
  let repository: Awaited<ReturnType<typeof managed.createManagedRepository>>;
  try {
    repository = await managed.createManagedRepository(params);
  } catch (error) {
    if (error instanceof managed.ManagedSeedFileError) {
      throw new ManagedSeedFileRefusedError(error.problem, error.path);
    }
    if (error instanceof managed.ManagedRepositoryProjectConflictError) {
      throw new ManagedProjectConflictError(params.projectId);
    }
    throw error;
  }
  const connection = await ensureManagedConnection(params.workspaceId);
  return {connectionId: connection.id, externalRepositoryId: repository.externalRepositoryId};
}

export async function deleteManagedProjectRepository(params: {
  workspaceId: string;
  projectId: string;
}): Promise<boolean> {
  const {deleteManagedRepository} = await import('@shipfox/api-integration-managed-vcs');
  return await deleteManagedRepository(params);
}

export interface CommitManagedProjectChangesParams {
  workspaceId: string;
  externalRepositoryId: string;
  branch: string;
  expectedHead?: string | undefined;
  message: string;
  changes: ReadonlyArray<{path: string; content: string | null}>;
  actor: {id: string; name: string};
}

/** Commits to a branch of the managed repository. The default branch is never written here. */
export async function commitManagedProjectChanges(
  params: CommitManagedProjectChangesParams,
): Promise<{branch: string; commit: string; parent: string}> {
  const managed = await import('@shipfox/api-integration-managed-vcs');
  try {
    return await managed.commitManagedChanges({
      workspaceId: params.workspaceId,
      repositoryId: parseProviderRepositoryId(params.externalRepositoryId, MANAGED_VCS_PROVIDER),
      branch: params.branch,
      expectedHead: params.expectedHead,
      message: params.message,
      changes: params.changes,
      author: {name: params.actor.name, email: `${params.actor.id}@users.noreply.shipfox.io`},
    });
  } catch (error) {
    if (error instanceof managed.ManagedCommitRefusedError) {
      throw new ConfigCommitRefusedError(error.refusal, error.details);
    }
    throw error;
  }
}

async function ensureManagedConnection(workspaceId: string) {
  return await retryConnectionSlugCollision(() =>
    db().transaction(async (tx) => {
      const slug = await resolveUniqueConnectionSlug(
        {
          workspaceId,
          provider: MANAGED_VCS_PROVIDER,
          externalAccountId: workspaceId,
          baseSlug: MANAGED_CONNECTION_SLUG,
        },
        {tx},
      );
      return await upsertIntegrationConnection(
        {
          workspaceId,
          provider: MANAGED_VCS_PROVIDER,
          externalAccountId: workspaceId,
          slug,
          displayName: 'Shipfox',
          lifecycleStatus: 'active',
          internal: true,
        },
        {tx},
      );
    }),
  );
}
