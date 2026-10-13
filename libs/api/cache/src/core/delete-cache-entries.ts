import {findReadyEntryInProject, listReadyEntriesInScope} from '#db/management.js';
import {deleteEntry} from './delete-entry.js';
import {ManagedEntryNotFoundError} from './errors.js';

const SCOPE_DELETION_BATCH_LIMIT = 100;

export interface CacheDeletionResult {
  deletedCount: number;
  deletedBytes: number;
}

/**
 * Deletes one committed entry of a project for a user. An entry that is not committed, or that
 * belongs to another project, is not found. An entry that a concurrent deletion removed first
 * counts as nothing deleted.
 */
export async function deleteCacheEntry(params: {
  projectId: string;
  entryId: string;
}): Promise<CacheDeletionResult> {
  const entry = await findReadyEntryInProject({id: params.entryId, projectId: params.projectId});
  if (!entry) throw new ManagedEntryNotFoundError(params.entryId);
  const deleted = await deleteEntry({entry, reason: 'manual'});
  return deleted
    ? {deletedCount: 1, deletedBytes: entry.sizeBytes}
    : {deletedCount: 0, deletedBytes: 0};
}

/**
 * Deletes every committed entry of one stored scope, objects first. A storage failure stops the
 * deletion and leaves the remaining entries listed, so a retry finishes the job. An upload in
 * flight is left to its own commit or to the sweeper.
 */
export async function deleteCacheScope(params: {
  projectId: string;
  scope: string;
}): Promise<CacheDeletionResult> {
  const result: CacheDeletionResult = {deletedCount: 0, deletedBytes: 0};
  let batch = await listReadyEntriesInScope({...params, limit: SCOPE_DELETION_BATCH_LIMIT});
  while (batch.length > 0) {
    for (const entry of batch) {
      if (await deleteEntry({entry, reason: 'manual'})) {
        result.deletedCount += 1;
        result.deletedBytes += entry.sizeBytes;
      }
    }
    batch = await listReadyEntriesInScope({...params, limit: SCOPE_DELETION_BATCH_LIMIT});
  }
  return result;
}
