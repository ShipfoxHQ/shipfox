import {CACHE_RECENT_DELETIONS_LIMIT} from '@shipfox/api-cache-dto';
import {
  listRecentDeletions,
  type ProjectStorageTotal,
  type RecordedDeletion,
  sumStoredBytesByProject,
} from '#db/management.js';
import type {WorkspaceStorageLimits} from './storage-policy.js';

export interface CacheUsage {
  storedBytes: number;
  limitBytes: number | null;
  projects: ProjectStorageTotal[];
  recentDeletions: RecordedDeletion[];
}

/** The workspace's committed entries as of now. It reads `cache_entries`, not usage records. */
export async function getCacheUsage(params: {
  workspaceId: string;
  limits: WorkspaceStorageLimits;
}): Promise<CacheUsage> {
  const [projects, recentDeletions, limitBytes] = await Promise.all([
    sumStoredBytesByProject(params.workspaceId),
    listRecentDeletions({workspaceId: params.workspaceId, limit: CACHE_RECENT_DELETIONS_LIMIT}),
    params.limits.maxStoredBytes(params.workspaceId),
  ]);
  return {
    storedBytes: projects.reduce((total, project) => total + project.storedBytes, 0),
    limitBytes,
    projects,
    recentDeletions,
  };
}
