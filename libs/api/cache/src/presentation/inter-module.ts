import {cacheInterModuleContract} from '@shipfox/api-cache-dto/inter-module';
import {
  type ProjectsModuleClient,
  projectsInterModuleContract,
} from '@shipfox/api-projects-dto/inter-module';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModulePresentation,
  isInterModuleKnownError,
} from '@shipfox/inter-module';
import {deleteCacheEntry, deleteCacheScope} from '#core/delete-cache-entries.js';
import {InvalidCursorError, ManagedEntryNotFoundError} from '#core/errors.js';
import {getCacheUsage} from '#core/get-cache-usage.js';
import {listCacheEntries} from '#core/list-cache-entries.js';
import type {WorkspaceStorageLimits} from '#core/storage-policy.js';

export function createCacheInterModulePresentation(params: {
  projects: Pick<ProjectsModuleClient, 'requireProjectForWorkspace'>;
  limits: WorkspaceStorageLimits;
}): InterModulePresentation<typeof cacheInterModuleContract> {
  const {projects, limits} = params;
  const methods = cacheInterModuleContract.methods;

  return defineInterModulePresentation(cacheInterModuleContract, {
    listCacheEntries: async ({workspaceId, projectId, scope, keyPrefix, cursor, limit}) => {
      await requireProject({workspaceId, projectId}, methods.listCacheEntries);
      try {
        const page = await listCacheEntries({projectId, scope, keyPrefix, cursor, limit});
        return {
          entries: page.entries.map((entry) => ({
            id: entry.id,
            scope: entry.scope,
            devSandbox: entry.devSandbox,
            key: entry.key,
            sizeBytes: entry.sizeBytes,
            createdAt: entry.createdAt.toISOString(),
            lastUsedAt: entry.lastUsedAt.toISOString(),
            createdByRunId: entry.createdByRunId,
            cursor: entry.cursor,
          })),
          nextCursor: page.nextCursor,
        };
      } catch (error) {
        if (error instanceof InvalidCursorError) {
          throw createInterModuleKnownError(methods.listCacheEntries, 'invalid-cursor', {});
        }
        throw error;
      }
    },
    getCacheUsage: async ({workspaceId}) => {
      const usage = await getCacheUsage({workspaceId, limits});
      return {
        ...usage,
        recentDeletions: usage.recentDeletions.map((deletion) => ({
          ...deletion,
          deletedAt: deletion.deletedAt.toISOString(),
        })),
      };
    },
    deleteCacheEntries: async ({workspaceId, projectId, target}) => {
      await requireProject({workspaceId, projectId}, methods.deleteCacheEntries);
      try {
        return 'entryId' in target
          ? await deleteCacheEntry({projectId, entryId: target.entryId})
          : await deleteCacheScope({projectId, scope: target.scope});
      } catch (error) {
        if (error instanceof ManagedEntryNotFoundError) {
          throw createInterModuleKnownError(methods.deleteCacheEntries, 'entry-not-found', {
            entryId: error.entryId,
          });
        }
        throw error;
      }
    },
  });

  /** A project of another workspace is reported as missing, like a project that does not exist. */
  async function requireProject(
    ids: {workspaceId: string; projectId: string},
    method: typeof methods.listCacheEntries | typeof methods.deleteCacheEntries,
  ): Promise<void> {
    try {
      await projects.requireProjectForWorkspace(ids);
    } catch (error) {
      if (
        isInterModuleKnownError(
          projectsInterModuleContract.methods.requireProjectForWorkspace,
          error,
        )
      ) {
        throw createInterModuleKnownError(method, 'project-not-found', {projectId: ids.projectId});
      }
      throw error;
    }
  }
}
