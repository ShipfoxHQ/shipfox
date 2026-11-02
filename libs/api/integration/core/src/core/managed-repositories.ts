import {MANAGED_VCS_PROVIDER} from '@shipfox/api-integration-managed-vcs-dto';
import {resolveUniqueConnectionSlug, upsertIntegrationConnection} from '#db/connections.js';
import {db} from '#db/db.js';
import {retryConnectionSlugCollision} from '#providers/connection-slug.js';
import {ManagedProjectConflictError, ManagedSeedFileRefusedError} from './errors.js';

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

  const connection = await ensureManagedConnection(params.workspaceId);
  try {
    const repository = await managed.createManagedRepository(params);
    return {
      connectionId: connection.id,
      externalRepositoryId: repository.externalRepositoryId,
    };
  } catch (error) {
    if (error instanceof managed.ManagedSeedFileError) {
      throw new ManagedSeedFileRefusedError(error.problem, error.path);
    }
    if (error instanceof managed.ManagedRepositoryProjectConflictError) {
      throw new ManagedProjectConflictError(params.projectId);
    }
    throw error;
  }
}

export async function deleteManagedProjectRepository(params: {
  workspaceId: string;
  projectId: string;
}): Promise<boolean> {
  const {deleteManagedRepository} = await import('@shipfox/api-integration-managed-vcs');
  return await deleteManagedRepository(params);
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
