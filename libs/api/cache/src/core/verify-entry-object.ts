import {logger} from '@shipfox/node-opentelemetry';
import {entryObjectKey, objectStore} from '#api/object-storage.js';
import {deleteReadyEntry} from '#db/entries.js';
import type {CacheEntry} from './entities/cache-entry.js';

export type EntryObjectState = 'present' | 'missing' | 'unknown';

/**
 * The row is the index and the object is the data, so a lookup confirms the object before it
 * trusts the row. A missing or resized object removes the row, which lets the lookup move on and
 * lets the next save run. Without this, a row whose object was removed by hand would stay a miss
 * forever, because every restore refreshes it and every save stops at `exists`.
 */
export async function verifyEntryObject(entry: CacheEntry): Promise<EntryObjectState> {
  const key = entryObjectKey(entry);
  let stored: Awaited<ReturnType<ReturnType<typeof objectStore>['head']>>;
  try {
    stored = await objectStore().head(key);
  } catch (error) {
    logger().warn({err: error, entryId: entry.id}, 'Cache object check failed; trusting the row');
    return 'unknown';
  }

  if (stored === null) {
    await deleteReadyEntry({entry, reason: 'missing'});
    return 'missing';
  }
  if (stored.contentLength !== entry.sizeBytes) {
    await objectStore().deleteObject(key);
    await deleteReadyEntry({entry, reason: 'missing'});
    return 'missing';
  }
  return 'present';
}
