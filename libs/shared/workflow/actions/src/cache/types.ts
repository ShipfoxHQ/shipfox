export interface CacheRestoreOptions {
  /**
   * Files, directories, or glob patterns. `node_modules` is relative to the step working
   * directory, `~/.npm` to the home directory, and `/opt/tools` is absolute. Restore puts each
   * back under the same anchor of the restoring job.
   */
  paths: readonly string[];
  /** Primary key, at most 512 characters. */
  key: string;
  /** Key prefixes tried in order when `key` misses. The newest matching entry wins. At most 10. */
  restoreKeys?: readonly string[];
  /** Scope read first. Defaults to `default`. */
  scope?: string;
  /** More scopes read in order after `scope`. At most 5. */
  fallbackScopes?: readonly string[];
}

export interface CacheRestoreResult {
  /** True when an entry with exactly `key` was restored. */
  hit: boolean;
  /** Key of the restored entry. Absent when nothing was restored. */
  matchedKey?: string;
  /** Scope of the restored entry, as the author wrote it. Absent when nothing was restored. */
  matchedScope?: string;
}

export interface CacheSaveOptions {
  /** The same value as the restore. */
  paths: readonly string[];
  key: string;
  /** Scope written. Defaults to `default`. */
  scope?: string;
}

export type CacheSkipReason =
  | 'exists'
  | 'in-progress'
  | 'no-match'
  | 'too-large'
  | 'cancelled'
  | 'failed';

export interface CacheSaveResult {
  /** True when this call created the entry. */
  saved: boolean;
  /** Why nothing was saved. Absent when `saved` is true. */
  reason?: CacheSkipReason;
}

/**
 * Saves files from the job and restores them in a later job of the same project. Best effort:
 * `restore` and `save` resolve with a result on a miss, a full workspace, or a storage failure.
 * They throw `CacheArgumentError` for arguments that can never work, and `restore` throws
 * `CacheExtractionError` when writing the files fails.
 */
export interface ActionCache {
  /**
   * Hashes the files matching the glob patterns, sorted by path, over the path and the content.
   * Returns 32 hex characters. Throws `CacheArgumentError` when nothing matches.
   */
  hashFiles(patterns: readonly string[]): Promise<string>;
  restore(options: CacheRestoreOptions): Promise<CacheRestoreResult>;
  save(options: CacheSaveOptions): Promise<CacheSaveResult>;
}
