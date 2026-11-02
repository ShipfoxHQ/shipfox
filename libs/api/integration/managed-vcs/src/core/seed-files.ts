import {Buffer} from 'node:buffer';
import {MAX_REPOSITORY_FILE_BYTES} from '@shipfox/api-integration-spi';

export const MANAGED_CONFIG_ROOT = '.shipfox';

// Matches a commit's limit, which also keeps a seed under the MCP body limit.
export const MAX_SEED_FILES = 100;
export const MAX_SEED_BYTES = 1024 * 1024;

export interface ManagedSeedFile {
  path: string;
  content: string;
}

export type ManagedSeedFileProblem =
  | 'path-not-allowed'
  | 'file-too-large'
  | 'too-many-files'
  | 'seed-too-large';

/** A seed file the repository refuses. `path` is empty when the problem is the seed as a whole. */
export class ManagedSeedFileError extends Error {
  constructor(
    readonly problem: ManagedSeedFileProblem,
    readonly path: string,
  ) {
    super(
      path === ''
        ? `The seed files were refused: ${problem}`
        : `The seed file ${path} was refused: ${problem}`,
    );
    this.name = 'ManagedSeedFileError';
  }
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: a path must not carry control characters
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/u;

/** Where a managed repository accepts a file: under `.shipfox/`, with no traversal or reserved segment. */
export function isAllowedPath(path: string): boolean {
  if (!path.startsWith(`${MANAGED_CONFIG_ROOT}/`)) return false;
  if (path.includes('\\') || CONTROL_CHARACTER_RE.test(path)) return false;
  return path
    .split('/')
    .every(
      (segment) => segment !== '' && segment !== '.' && segment !== '..' && segment !== '.git',
    );
}

/** Checks the seed before anything is written. Every file is stored as a regular text file. */
export function assertSeedFiles(files: readonly ManagedSeedFile[]): void {
  if (files.length > MAX_SEED_FILES) throw new ManagedSeedFileError('too-many-files', '');

  const paths = new Set<string>();
  let total = 0;
  for (const file of files) {
    if (!isAllowedPath(file.path) || paths.has(file.path)) {
      throw new ManagedSeedFileError('path-not-allowed', file.path);
    }
    paths.add(file.path);

    const size = Buffer.byteLength(file.content);
    if (size > MAX_REPOSITORY_FILE_BYTES)
      throw new ManagedSeedFileError('file-too-large', file.path);
    total += size;
  }
  if (total > MAX_SEED_BYTES) throw new ManagedSeedFileError('seed-too-large', '');

  const conflict = findFileDirectoryConflict(paths);
  if (conflict !== undefined) throw new ManagedSeedFileError('path-not-allowed', conflict);
}

/** A file and a directory can't share a path. Answers the first file that sits under another. */
export function findFileDirectoryConflict(paths: ReadonlySet<string>): string | undefined {
  for (const path of paths) {
    const segments = path.split('/');
    for (let end = 1; end < segments.length; end += 1) {
      if (paths.has(segments.slice(0, end).join('/'))) return path;
    }
  }
  return undefined;
}
