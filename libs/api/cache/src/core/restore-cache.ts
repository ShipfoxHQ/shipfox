import {entryObjectKey, objectStore} from '#api/object-storage.js';
import {config} from '#config.js';
import {findNewestReadyEntryByPrefix, findReadyEntryByKey, touchEntry} from '#db/entries.js';
import {cacheRestoreCount} from '#metrics/instance.js';
import type {CacheEntry} from './entities/cache-entry.js';
import type {CacheLease} from './lease.js';
import type {ScopeView} from './scopes.js';
import {verifyEntryObject} from './verify-entry-object.js';

export interface RestoreCacheParams {
  lease: CacheLease;
  scopes: ScopeView;
  scope: string;
  fallbackScopes: string[];
  key: string;
  restoreKeys: string[];
  version: string;
}

export interface CacheHit {
  entry: CacheEntry;
  /** The scope the author wrote, not the dev sandbox that held the entry. */
  scope: string;
  exact: boolean;
  url: string;
}

/**
 * Per authored scope in order, and per stored scope inside it: the entry whose key equals the
 * primary key, then for each restore key the newest entry that starts with it. The first entry
 * whose object still exists wins.
 */
export async function restoreCache(params: RestoreCacheParams): Promise<CacheHit | null> {
  const {projectId} = params.lease;
  for (const scope of [params.scope, ...params.fallbackScopes]) {
    for (const storedScope of params.scopes.readScopes(scope)) {
      const identity = {projectId, scope: storedScope, version: params.version};

      const exact = await firstPresent(() => findReadyEntryByKey({...identity, key: params.key}));
      if (exact) return await hit({entry: exact, scope, exact: true});

      for (const prefix of params.restoreKeys) {
        const matched = await firstPresent(() =>
          findNewestReadyEntryByPrefix({...identity, prefix}),
        );
        if (matched) return await hit({entry: matched, scope, exact: false});
      }
    }
  }
  cacheRestoreCount.add(1, {result: 'miss'});
  return null;
}

// A missing object deletes its row, so asking again yields the next candidate.
async function firstPresent(
  find: () => Promise<CacheEntry | undefined>,
): Promise<CacheEntry | undefined> {
  for (let entry = await find(); entry; entry = await find()) {
    if ((await verifyEntryObject(entry)) !== 'missing') return entry;
  }
  return undefined;
}

async function hit(params: {entry: CacheEntry; scope: string; exact: boolean}): Promise<CacheHit> {
  const {entry} = params;
  const {url} = await objectStore().presignGet(entryObjectKey(entry), config.CACHE_URL_TTL_SECONDS);
  await touchEntry(entry.id);
  cacheRestoreCount.add(1, {result: params.exact ? 'exact' : 'prefix'});
  return {entry, scope: params.scope, exact: params.exact, url};
}
