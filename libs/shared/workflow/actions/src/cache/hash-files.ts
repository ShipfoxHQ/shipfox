import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {join} from 'node:path';
import {type HashFilesLimit, HashFilesLimitError, HashFilesNoMatchError} from '#cache/errors.js';
import {
  ANCHORS,
  type AvailableAnchorDirectories,
  expandAnchoredPaths,
  parseAnchoredPaths,
} from '#cache/paths.js';

const HASH_HEX_LENGTH = 32;

export interface HashFilesLimits {
  readonly maxFiles: number;
  readonly maxBytes: number;
}

/** The limits the runner applies to a `hashFiles()` expression call. */
export const HASH_FILES_RUNNER_LIMITS: HashFilesLimits = {maxFiles: 10_000, maxBytes: 1024 ** 3};

export interface HashFilesResult {
  /** 32 hex characters. */
  readonly hash: string;
  /** The number of regular files hashed. */
  readonly files: number;
}

/**
 * SHA-256 over the matched regular files, sorted by anchor and path, each hashed as path plus
 * content. Directories and dangling symlinks are skipped. A file that cannot be read fails the
 * call, since a key built from fewer files would differ silently.
 *
 * A pattern under an anchor missing from `directories` throws `CacheArgumentError`. No match
 * throws `HashFilesNoMatchError`, and going over `limits` throws `HashFilesLimitError`. Without
 * `limits`, nothing is capped.
 */
export async function hashFiles(params: {
  patterns: readonly string[];
  directories: AvailableAnchorDirectories;
  limits?: HashFilesLimits | undefined;
  signal?: AbortSignal | undefined;
}): Promise<HashFilesResult> {
  const parsed = parseAnchoredPaths(params.patterns, 'hashFiles patterns');
  const members = await expandAnchoredPaths(parsed, params.directories, {
    signal: params.signal,
    pruneCovered: false,
  });
  const budget = new Budget(params.limits ?? UNLIMITED, params.patterns);

  const outer = createHash('sha256');
  let files = 0;
  for (const anchor of ANCHORS) {
    const directory = params.directories[anchor];
    if (directory === undefined) continue;
    for (const member of members.get(anchor) ?? []) {
      const path = join(directory, member);
      const size = await regularFileSize(path);
      if (size === undefined) continue;
      budget.addFile(size);
      outer.update(`${anchor}:${member}\0${await hashContent(path, budget, params.signal)}\n`);
      files += 1;
    }
  }
  if (files === 0) throw new HashFilesNoMatchError(params.patterns);
  return {hash: outer.digest('hex').slice(0, HASH_HEX_LENGTH), files};
}

const UNLIMITED: HashFilesLimits = {
  maxFiles: Number.POSITIVE_INFINITY,
  maxBytes: Number.POSITIVE_INFINITY,
};

class Budget {
  private readonly limits: HashFilesLimits;
  private readonly patterns: readonly string[];
  private files = 0;
  private bytes = 0;

  constructor(limits: HashFilesLimits, patterns: readonly string[]) {
    this.limits = limits;
    this.patterns = patterns;
  }

  /** Checks the stat size before reading, so an oversized file is never opened. */
  addFile(size: number): void {
    this.files += 1;
    if (this.files > this.limits.maxFiles) this.fail('files', this.limits.maxFiles);
    if (this.bytes + size > this.limits.maxBytes) this.fail('bytes', this.limits.maxBytes);
  }

  /** Counts while streaming, since a file can grow after its stat. */
  addBytes(count: number): void {
    this.bytes += count;
    if (this.bytes > this.limits.maxBytes) this.fail('bytes', this.limits.maxBytes);
  }

  private fail(limit: HashFilesLimit, max: number): never {
    throw new HashFilesLimitError({limit, max, patterns: this.patterns});
  }
}

async function regularFileSize(path: string): Promise<number | undefined> {
  try {
    const stats = await stat(path);
    return stats.isFile() ? stats.size : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function hashContent(
  path: string,
  budget: Budget,
  signal: AbortSignal | undefined,
): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, signal ? {signal} : {})) {
    budget.addBytes((chunk as Buffer).length);
    hash.update(chunk);
  }
  return hash.digest('hex');
}
