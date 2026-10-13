import {listScopeSummaries} from '#db/management.js';
import {type DevSandbox, parseDevSandbox} from './scopes.js';

export interface CacheScopeListing {
  /** The stored scope, which is `dev/{userId}/{scope}` for a dev sandbox. */
  scope: string;
  devSandbox: DevSandbox | null;
  entryCount: number;
  sizeBytes: number;
  lastUsedAt: Date;
}

/** The scopes of a project that hold committed entries, most recently used first. */
export async function listCacheScopes(projectId: string): Promise<CacheScopeListing[]> {
  const summaries = await listScopeSummaries(projectId);
  return summaries.map((summary) => ({...summary, devSandbox: parseDevSandbox(summary.scope)}));
}
