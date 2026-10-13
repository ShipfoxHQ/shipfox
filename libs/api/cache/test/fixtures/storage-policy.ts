import type {CacheStoragePolicy} from '#core/storage-policy.js';

/** Limits only the workspaces it is told about, so entries of other tests are never evicted. */
export function fakeStoragePolicy(): CacheStoragePolicy & {
  limit(workspaceId: string, maxStoredBytes: number): void;
  fail(workspaceId: string): void;
} {
  const limits = new Map<string, number>();
  const failing = new Set<string>();
  return {
    limit: (workspaceId, maxStoredBytes) => limits.set(workspaceId, maxStoredBytes),
    fail: (workspaceId) => failing.add(workspaceId),
    resolve: ({workspaceId}) =>
      failing.has(workspaceId)
        ? Promise.reject(new Error('policy unavailable'))
        : Promise.resolve({maxStoredBytes: limits.get(workspaceId) ?? null}),
  };
}
