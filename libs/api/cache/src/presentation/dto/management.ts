import type {
  CacheEntrySummaryDto,
  CacheScopeSummaryDto,
  CacheSettingsResponseDto,
  CacheUsageResponseDto,
  DeleteCacheScopeResponseDto,
} from '@shipfox/api-cache-dto';
import type {CacheDeletionResult} from '#core/delete-cache-entries.js';
import type {CacheUsage} from '#core/get-cache-usage.js';
import type {ManagedCacheEntry} from '#core/list-cache-entries.js';
import type {CacheScopeListing} from '#core/list-cache-scopes.js';
import type {DevSandbox} from '#core/scopes.js';
import type {WorkspaceRetention} from '#core/workspace-retention.js';

function toDevSandboxDto(sandbox: DevSandbox | null) {
  return sandbox ? {user_id: sandbox.userId, scope: sandbox.scope} : null;
}

export function toCacheScopeSummaryDto(listing: CacheScopeListing): CacheScopeSummaryDto {
  return {
    scope: listing.scope,
    dev_sandbox: toDevSandboxDto(listing.devSandbox),
    entry_count: listing.entryCount,
    size_bytes: listing.sizeBytes,
    last_used_at: listing.lastUsedAt.toISOString(),
  };
}

export function toCacheEntrySummaryDto(entry: ManagedCacheEntry): CacheEntrySummaryDto {
  return {
    id: entry.id,
    scope: entry.scope,
    dev_sandbox: toDevSandboxDto(entry.devSandbox),
    key: entry.key,
    size_bytes: entry.sizeBytes,
    created_at: entry.createdAt.toISOString(),
    last_used_at: entry.lastUsedAt.toISOString(),
    created_by_run_id: entry.createdByRunId,
  };
}

export function toDeleteCacheScopeDto(result: CacheDeletionResult): DeleteCacheScopeResponseDto {
  return {deleted_count: result.deletedCount, deleted_bytes: result.deletedBytes};
}

export function toCacheUsageDto(usage: CacheUsage): CacheUsageResponseDto {
  return {
    stored_bytes: usage.storedBytes,
    limit_bytes: usage.limitBytes,
    projects: usage.projects.map((project) => ({
      project_id: project.projectId,
      stored_bytes: project.storedBytes,
      entry_count: project.entryCount,
    })),
    recent_deletions: usage.recentDeletions.map((deletion) => ({
      project_id: deletion.projectId,
      scope: deletion.scope,
      key: deletion.key,
      size_bytes: deletion.sizeBytes,
      reason: deletion.reason,
      deleted_at: deletion.deletedAt.toISOString(),
    })),
  };
}

export function toCacheSettingsDto(retention: WorkspaceRetention): CacheSettingsResponseDto {
  return {
    retention_days: retention.retentionDays,
    default_retention_days: retention.defaultRetentionDays,
    max_retention_days: retention.maxRetentionDays,
  };
}
