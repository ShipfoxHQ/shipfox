import {execFile} from 'node:child_process';
import {copyFile, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const GIT_OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;
const SYMLINK_MODE = '120000';
const SUBMODULE_MODE = '160000';
const EXECUTABLE_MODE = '100755';
const ABSENT_MODE = '000000';

export interface FileAddition {
  path: string;
  contents: string;
  encoding: 'utf8' | 'base64';
}

export interface ChangeSet {
  additions: FileAddition[];
  deletions: {path: string}[];
  /** Decoded bytes across all additions, the unit of `create_commit`'s limit. */
  bytes: number;
}

/**
 * Compares the working tree with `base`, so local commits made after `base` are included. The
 * comparison stages into a copy of the index, which leaves the job's own index and files as is.
 */
export async function collectChanges(params: {
  base: string;
  paths: readonly string[];
}): Promise<ChangeSet> {
  const root = (await git(['rev-parse', '--show-toplevel'])).trim();
  await assertCommitExists(params.base);
  const directory = await mkdtemp(join(tmpdir(), 'verified-commit-'));
  try {
    const index = join(directory, 'index');
    // --git-path answers relative to the working directory, not to the repository root.
    await copyFile(resolve((await git(['rev-parse', '--git-path', 'index'])).trim()), index);
    const env = {...process.env, GIT_INDEX_FILE: index};
    await git(['add', '--all', '--', ':/'], env);
    const pathspec =
      params.paths.length === 0 ? [':/'] : params.paths.map((path) => `:(top,literal)${path}`);
    const raw = await git(
      ['diff', '--cached', '--raw', '-z', '--no-renames', params.base, '--', ...pathspec],
      env,
    );
    return await readChanges(root, parseRawDiff(raw));
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}

interface RawChange {
  oldMode: string;
  newMode: string;
  status: string;
  path: string;
}

function parseRawDiff(raw: string): RawChange[] {
  const fields = raw.split('\0');
  const changes: RawChange[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const [oldMode = '', newMode = '', , , status = ''] = (fields[index] ?? '').slice(1).split(' ');
    changes.push({oldMode, newMode, status, path: fields[index + 1] ?? ''});
  }
  return changes;
}

async function readChanges(root: string, changes: RawChange[]): Promise<ChangeSet> {
  const additions: FileAddition[] = [];
  const deletions: {path: string}[] = [];
  let bytes = 0;
  for (const change of changes) {
    assertPublishable(change);
    if (change.status === 'D') {
      deletions.push({path: change.path});
      continue;
    }
    const contents = await readFile(join(root, change.path));
    bytes += contents.byteLength;
    additions.push(encodeAddition(change.path, contents));
  }
  return {additions, deletions, bytes};
}

// GitHub's commit API writes regular files only, so anything it would silently flatten fails.
function assertPublishable(change: RawChange): void {
  const modes = [change.oldMode, change.newMode];
  if (modes.includes(SYMLINK_MODE)) {
    throw new Error(`${change.path} is a symbolic link, which a verified commit cannot hold.`);
  }
  if (modes.includes(SUBMODULE_MODE)) {
    throw new Error(`${change.path} is a submodule, which a verified commit cannot change.`);
  }
  const modeChanged = change.oldMode !== ABSENT_MODE && change.oldMode !== change.newMode;
  const newExecutable = change.oldMode === ABSENT_MODE && change.newMode === EXECUTABLE_MODE;
  if (change.status !== 'D' && (modeChanged || newExecutable)) {
    throw new Error(`${change.path} changes file mode, which a verified commit cannot record.`);
  }
}

function encodeAddition(path: string, contents: Buffer): FileAddition {
  const text = decodeUtf8(contents);
  return text === undefined
    ? {path, contents: contents.toString('base64'), encoding: 'base64'}
    : {path, contents: text, encoding: 'utf8'};
}

function decodeUtf8(contents: Buffer): string | undefined {
  if (contents.includes(0)) return undefined;
  try {
    return new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(contents);
  } catch {
    return undefined;
  }
}

async function assertCommitExists(sha: string): Promise<void> {
  try {
    await git(['cat-file', '-e', `${sha}^{commit}`]);
  } catch {
    throw new Error(
      `Commit ${sha} is not in the local checkout. Check out with enough history to include it.`,
    );
  }
}

async function git(args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const {stdout} = await execFileAsync('git', args, {
    ...(env === undefined ? {} : {env}),
    maxBuffer: GIT_OUTPUT_LIMIT_BYTES,
  });
  return stdout;
}
