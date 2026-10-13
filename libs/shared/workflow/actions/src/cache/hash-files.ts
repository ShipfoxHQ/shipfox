import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {join} from 'node:path';
import {CacheArgumentError} from '#cache/errors.js';
import {
  ANCHORS,
  type AnchorDirectories,
  expandAnchoredPaths,
  parseAnchoredPaths,
} from '#cache/paths.js';

const HASH_HEX_LENGTH = 32;

/**
 * SHA-256 over the matched regular files, sorted by anchor and path, each hashed as path plus
 * content. Directories and dangling symlinks are skipped. A file that cannot be read fails the call, since
 * a key built from fewer files would differ silently.
 */
export async function hashFiles(params: {
  patterns: readonly string[];
  directories: AnchorDirectories;
  signal?: AbortSignal | undefined;
}): Promise<string> {
  const parsed = parseAnchoredPaths(params.patterns, 'hashFiles patterns');
  const members = await expandAnchoredPaths(parsed, params.directories, {
    signal: params.signal,
    pruneCovered: false,
  });

  const outer = createHash('sha256');
  let files = 0;
  for (const anchor of ANCHORS) {
    for (const member of members.get(anchor) ?? []) {
      const path = join(params.directories[anchor], member);
      if (!(await isFile(path))) continue;
      outer.update(`${anchor}:${member}\0${await hashContent(path, params.signal)}\n`);
      files += 1;
    }
  }
  if (files === 0) {
    throw new CacheArgumentError(
      `hashFiles matched no files for ${params.patterns.join(', ')}. A key built from nothing would be shared by every run.`,
    );
  }
  return outer.digest('hex').slice(0, HASH_HEX_LENGTH);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function hashContent(path: string, signal: AbortSignal | undefined): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, signal ? {signal} : {})) hash.update(chunk);
  return hash.digest('hex');
}
