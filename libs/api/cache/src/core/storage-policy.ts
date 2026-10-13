import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {config} from '#config.js';

export interface CacheStorageLimits {
  /** Most bytes of committed entries the workspace may store. `null` means no limit. */
  maxStoredBytes: number | null;
}

export interface CacheStoragePolicy {
  resolve(input: {workspaceId: string}): Promise<CacheStorageLimits>;
}

export interface WorkspaceStorageLimits {
  /**
   * The limit to enforce for the workspace now, or `null` for none. A policy that throws also
   * answers `null`, so a failing policy never evicts and never refuses a save.
   */
  maxStoredBytes(workspaceId: string): Promise<number | null>;
}

const LIMIT_CACHE_TTL_MS = 60_000;

const configuredPolicy: CacheStoragePolicy = {
  resolve: () => Promise.resolve({maxStoredBytes: config.CACHE_WORKSPACE_MAX_BYTES ?? null}),
};

export function createWorkspaceStorageLimits(
  policy: CacheStoragePolicy = configuredPolicy,
  now: () => number = Date.now,
): WorkspaceStorageLimits {
  const resolved = new Map<string, {maxStoredBytes: number | null; expiresAt: number}>();

  return {
    async maxStoredBytes(workspaceId) {
      const cached = resolved.get(workspaceId);
      if (cached && cached.expiresAt > now()) return cached.maxStoredBytes;

      try {
        const {maxStoredBytes} = await policy.resolve({workspaceId});
        resolved.set(workspaceId, {maxStoredBytes, expiresAt: now() + LIMIT_CACHE_TTL_MS});
        return maxStoredBytes;
      } catch (error) {
        logger().warn({err: error, workspaceId}, 'Cache storage policy failed; no limit applied');
        reportError(error, {boundary: 'cache.storage-policy', extra: {workspaceId}});
        return null;
      }
    },
  };
}
