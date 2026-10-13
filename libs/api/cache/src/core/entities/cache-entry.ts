export type CacheEntryStatus = 'uploading' | 'ready';

export type CacheDeletionReason = 'expired' | 'evicted' | 'manual' | 'missing';

export interface CacheEntry {
  id: string;
  workspaceId: string;
  projectId: string;
  /** The stored scope, which is `dev/{userId}/{scope}` for a dev sandbox. */
  scope: string;
  key: string;
  version: string;
  status: CacheEntryStatus;
  sizeBytes: number;
  sha256: string;
  uploadId: string | null;
  createdByRunId: string;
  createdByJobExecutionId: string;
  createdAt: Date;
  committedAt: Date | null;
  lastAccessedAt: Date;
}
