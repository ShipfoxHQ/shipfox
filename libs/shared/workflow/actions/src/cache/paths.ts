import {glob, lstat} from 'node:fs/promises';
import {join, sep} from 'node:path';
import {
  type AnchoredPatternFailureReason,
  type PathAnchor,
  parseAnchoredPattern,
} from '@shipfox/workflow-document/anchored-path';
import {CacheArgumentError} from '#cache/errors.js';

/** Where a path is anchored: the step working directory, the home directory, or `/`. */
export type Anchor = PathAnchor;

export const ANCHORS: readonly Anchor[] = ['cwd', 'home', 'root'];

export type AnchorDirectories = Readonly<Record<Anchor, string>>;

/** The working directory is always known. A path under a missing anchor fails to expand. */
export type AvailableAnchorDirectories = {readonly cwd: string} & Readonly<
  Partial<Record<Anchor, string>>
>;

export interface AnchoredPath {
  readonly anchor: Anchor;
  /** Relative to the anchor directory, normalized, with `/` separators. */
  readonly pattern: string;
}

const GLOB_CHARACTERS_RE = /[*?[\]{}]|[!@+]\(/;

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
  const parsed = parseAnchoredPattern(line);
  if (parsed.ok) return {anchor: parsed.anchor, pattern: parsed.pattern};
  throw new CacheArgumentError(failureMessage(parsed, line, what));
}

function failureMessage(
  failure: {reason: AnchoredPatternFailureReason; anchor?: Anchor},
  line: unknown,
  what: string,
): string {
  const written = typeof line === 'string' ? line.trim() : '';
  switch (failure.reason) {
    case 'empty':
      return `${what} needs non-empty strings, but got ${describe(line)}.`;
    case 'control-character':
      return `${what}: "${written}" cannot contain a line break or NUL.`;
    case 'whole-anchor':
      return `"${written}" is the whole ${failure.anchor} directory. Name something inside it.`;
    case 'leaves-anchor':
      return failure.anchor === 'cwd'
        ? `"${written}" leaves the working directory. Use an absolute path for files outside it.`
        : `"${written}" leaves the ${failure.anchor} directory.`;
  }
}

/**
 * Matches the patterns inside their anchor directories. Members are relative to their anchor and
 * sorted. With `pruneCovered`, a member inside another matched directory is dropped, so `tar`
 * does not store it twice.
 */
export async function expandAnchoredPaths(
  paths: readonly AnchoredPath[],
  directories: AvailableAnchorDirectories,
  options: {signal?: AbortSignal | undefined; pruneCovered: boolean},
): Promise<Map<Anchor, string[]>> {
  const found = new Map<Anchor, Set<string>>();
  for (const {anchor, pattern} of paths) {
    const directory = directories[anchor];
    if (directory === undefined) {
      const written = `${anchor === 'home' ? '~/' : '/'}${pattern}`;
      throw new CacheArgumentError(
        `"${written}" is in the ${anchor} directory, which is not available here.`,
      );
    }
    const members = found.get(anchor) ?? new Set<string>();
    for (const member of await expand(directory, pattern, options.signal)) {
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
    matches.push(toPosixMember(match, sep));
  }
  return matches;
}

/**
 * Converts a glob match from the native separator to `/`, so a member and its hash are the same
 * on every platform. Only a `\` separator is converted: on POSIX, `\` is a legal name character.
 */
export function toPosixMember(match: string, separator: string): string {
  return separator === '\\' ? match.replaceAll('\\', '/') : match;
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
