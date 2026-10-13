import {findEntryById} from '#db/entries.js';
import type {CacheEntry} from './entities/cache-entry.js';
import {CacheEntryNotFoundError} from './errors.js';
import type {CacheLease} from './lease.js';

/**
 * Uploads belong to the job execution that reserved them. Another execution gets the same answer
 * as a missing entry, so an id does not reveal what other jobs are saving.
 */
export async function findOwnedEntry(params: {
  lease: CacheLease;
  entryId: string;
}): Promise<CacheEntry> {
  const entry = await findEntryById({id: params.entryId, projectId: params.lease.projectId});
  if (!entry || entry.createdByJobExecutionId !== params.lease.jobExecutionId) {
    throw new CacheEntryNotFoundError(params.entryId);
  }
  return entry;
}
