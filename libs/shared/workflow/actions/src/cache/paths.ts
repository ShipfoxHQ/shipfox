import {glob, lstat} from 'node:fs/promises';
import {join, posix} from 'node:path';
import {CacheArgumentError} from '#cache/errors.js';

/** Where a path is anchored: the step working directory, the home directory, or `/`. */
export type Anchor = 'cwd' | 'home' | 'root';

export const ANCHORS: readonly Anchor[] = ['cwd', 'home', 'root'];

export type AnchorDirectories = Readonly<Record<Anchor, string>>;

export interface AnchoredPath {
  readonly anchor: Anchor;
  /** Relative to the anchor directory, normalized, with `/` separators. */
  readonly pattern: string;
}

const GLOB_CHARACTERS_RE = /[*?[\]{}]|[!@+]\(/;
const HOME_PREFIX_RE = /^~(?:\/|$)/;
const LEADING_SLASHES_RE = /^\/+/;
const TRAILING_SLASH_RE = /\/$/;

/**
 * Reads the anchor from how a line is written, not from where it points. `paths` is hashed into
 * the version as written, so this never rewrites a line before it decides.
 */
export function parseAnchoredPaths(paths: readonly string[], what = 'paths'): AnchoredPath[] {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new CacheArgumentError(`${what} needs at least one path.`);
  }
  return paths.map((line) => parseAnchoredPath(line, what));
}

function parseAnchoredPath(line: unknown, what: string): AnchoredPath {
  if (typeof line !== 'string' || line.trim() === '') {
    throw new CacheArgumentError(`${what} needs non-empty strings, but got ${describe(line)}.`);
  }
  const written = line.trim();
  if (written.includes('\n') || written.includes('\0')) {
    throw new CacheArgumentError(`${what}: "${written}" cannot contain a line break or NUL.`);
  }

  if (HOME_PREFIX_RE.test(written)) {
    return anchored('home', written.slice(1).replace(LEADING_SLASHES_RE, ''), written);
  }
  if (written.startsWith('/')) {
    return anchored('root', written.replace(LEADING_SLASHES_RE, ''), written);
  }
  return anchored('cwd', written, written);
}

function anchored(anchor: Anchor, relative: string, written: string): AnchoredPath {
  if (relative === '' && anchor !== 'cwd') {
    throw new CacheArgumentError(
      `"${written}" is the whole ${anchor === 'home' ? 'home' : 'root'} directory. Name something inside it.`,
    );
  }
  const pattern = posix.normalize(relative === '' ? '.' : relative).replace(TRAILING_SLASH_RE, '');
  if (pattern === '..' || pattern.startsWith('../')) {
    throw new CacheArgumentError(
      anchor === 'cwd'
        ? `"${written}" leaves the working directory. Use an absolute path for files outside it.`
        : `"${written}" leaves the ${anchor} directory.`,
    );
  }
  return {anchor, pattern};
}

/**
 * Matches the patterns inside their anchor directories. Members are relative to their anchor and
 * sorted. With `pruneCovered`, a member inside another matched directory is dropped, so `tar`
 * does not store it twice.
 */
export async function expandAnchoredPaths(
  paths: readonly AnchoredPath[],
  directories: AnchorDirectories,
  options: {signal?: AbortSignal | undefined; pruneCovered: boolean},
): Promise<Map<Anchor, string[]>> {
  const found = new Map<Anchor, Set<string>>();
  for (const {anchor, pattern} of paths) {
    const members = found.get(anchor) ?? new Set<string>();
    for (const member of await expand(directories[anchor], pattern, options.signal)) {
      members.add(member);
    }
    found.set(anchor, members);
  }

  const result = new Map<Anchor, string[]>();
  for (const anchor of ANCHORS) {
    const members = [...(found.get(anchor) ?? [])].sort();
    const kept = options.pruneCovered
      ? members.filter((member) => !isCovered(member, members))
      : members;
    if (kept.length > 0) result.set(anchor, kept);
  }
  return result;
}

async function expand(
  directory: string,
  pattern: string,
  signal: AbortSignal | undefined,
): Promise<string[]> {
  if (!GLOB_CHARACTERS_RE.test(pattern)) {
    return (await exists(join(directory, pattern))) ? [pattern] : [];
  }
  const matches: string[] = [];
  for await (const match of glob(pattern, {cwd: directory})) {
    signal?.throwIfAborted();
    // The member list is one name per line, so a name with a line break would split in two.
    if (match.includes('\n')) {
      throw new CacheArgumentError(
        `${directory}: a path matching ${pattern} contains a line break.`,
      );
    }
    matches.push(match);
  }
  return matches;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function isCovered(member: string, members: readonly string[]): boolean {
  return members.some(
    (other) => other !== member && (other === '.' || member.startsWith(`${other}/`)),
  );
}

function describe(value: unknown): string {
  return value === null ? 'null' : typeof value;
}
