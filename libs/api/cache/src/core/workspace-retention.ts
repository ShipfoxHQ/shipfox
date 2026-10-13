import {config} from '#config.js';
import {findWorkspaceRetentionDays, upsertWorkspaceRetentionDays} from '#db/management.js';
import {RetentionOutOfRangeError} from './errors.js';

export interface WorkspaceRetention {
  retentionDays: number;
  defaultRetentionDays: number;
  maxRetentionDays: number;
}

export async function getWorkspaceRetention(workspaceId: string): Promise<WorkspaceRetention> {
  const retentionDays = await findWorkspaceRetentionDays(workspaceId);
  return {
    retentionDays: retentionDays ?? config.CACHE_DEFAULT_RETENTION_DAYS,
    defaultRetentionDays: config.CACHE_DEFAULT_RETENTION_DAYS,
    maxRetentionDays: config.CACHE_MAX_RETENTION_DAYS,
  };
}

/** A shorter value applies at the next sweep. */
export async function setWorkspaceRetention(params: {
  workspaceId: string;
  retentionDays: number;
}): Promise<WorkspaceRetention> {
  if (params.retentionDays < 1 || params.retentionDays > config.CACHE_MAX_RETENTION_DAYS) {
    throw new RetentionOutOfRangeError(params.retentionDays, config.CACHE_MAX_RETENTION_DAYS);
  }
  await upsertWorkspaceRetentionDays(params);
  return await getWorkspaceRetention(params.workspaceId);
}
