import {findReadyEntryByKey, touchEntry} from '#db/entries.js';
import type {CacheLease} from './lease.js';
import {verifyEntryObject} from './verify-entry-object.js';

/**
 * Lets a save skip archiving when the key exists. A hit refreshes the entry, so saving the same
 * key again extends its retention without a second call.
 */
export async function checkCacheEntry(params: {
  lease: CacheLease;
  writeScope: string;
  key: string;
  version: string;
}): Promise<boolean> {
  const entry = await findReadyEntryByKey({
    projectId: params.lease.projectId,
    scope: params.writeScope,
    key: params.key,
    version: params.version,
  });
  if (!entry) return false;
  if ((await verifyEntryObject(entry)) === 'missing') return false;
  await touchEntry(entry.id);
  return true;
}
