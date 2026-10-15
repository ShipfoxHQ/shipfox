/** Where a path is anchored: the step working directory, the home directory, or `/`. */
export type PathAnchor = 'cwd' | 'home' | 'root';

export type AnchoredPatternFailureReason =
  | 'empty'
  | 'control-character'
  | 'whole-anchor'
  | 'leaves-anchor';

export type AnchoredPatternResult =
  | {
      readonly ok: true;
      readonly anchor: PathAnchor;
      /** Relative to the anchor directory, normalized, with `/` separators. */
      readonly pattern: string;
    }
  | {
      readonly ok: false;
      readonly reason: AnchoredPatternFailureReason;
      /** Set for `whole-anchor` and `leaves-anchor`. */
      readonly anchor?: PathAnchor;
    };

const HOME_PREFIX_RE = /^~(?:\/|$)/;
const LEADING_SLASHES_RE = /^\/+/;
const TRAILING_SLASH_RE = /\/$/;

/**
 * Reads the anchor from how a line is written, not from where it points: `~` or `~/` is the home
 * directory, a leading `/` is the root, and anything else is the working directory. The line is
 * trimmed but otherwise never rewritten before the anchor is decided. Pure, so the API and the
 * runner accept the same patterns.
 */
export function parseAnchoredPattern(line: unknown): AnchoredPatternResult {
  if (typeof line !== 'string' || line.trim() === '') return {ok: false, reason: 'empty'};
  const written = line.trim();
  if (written.includes('\n') || written.includes('\0')) {
    return {ok: false, reason: 'control-character'};
  }

  if (HOME_PREFIX_RE.test(written)) {
    return anchored('home', written.slice(1).replace(LEADING_SLASHES_RE, ''));
  }
  if (written.startsWith('/')) return anchored('root', written.replace(LEADING_SLASHES_RE, ''));
  return anchored('cwd', written);
}

function anchored(anchor: PathAnchor, relative: string): AnchoredPatternResult {
  if (relative === '' && anchor !== 'cwd') return {ok: false, reason: 'whole-anchor', anchor};
  const pattern = normalizeRelativePath(relative).replace(TRAILING_SLASH_RE, '');
  if (pattern === '..' || pattern.startsWith('../')) {
    return {ok: false, reason: 'leaves-anchor', anchor};
  }
  // `/tmp/..` normalizes to the anchor itself.
  if (pattern === '.' && anchor !== 'cwd') return {ok: false, reason: 'whole-anchor', anchor};
  return {ok: true, anchor, pattern};
}

/**
 * Matches `posix.normalize` from `node:path` for a relative path, without depending on Node.
 * Leading `..` segments are kept so the caller can see an escape.
 */
export function normalizeRelativePath(path: string): string {
  if (path === '') return '.';
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    const canResolveParent = segments.length > 0 && segments.at(-1) !== '..';
    if (segment !== '..') segments.push(segment);
    else if (canResolveParent) segments.pop();
    else segments.push('..');
  }
  const normalized = segments.length === 0 ? '.' : segments.join('/');
  return path.endsWith('/') ? `${normalized}/` : normalized;
}
