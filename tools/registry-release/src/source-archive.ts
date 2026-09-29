import {execFile} from 'node:child_process';
import {lstat, readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {type ActionBundleFile, encodeActionBundle} from '@shipfox/workflow-document';

const execFileAsync = promisify(execFile);
const excludedSegments = new Set(['node_modules', 'dist', 'build']);

/**
 * The files of a package directory that Git tracks, as text. The source
 * archive uses the bundle codec, so one digest implementation serves the
 * registry, the runner, and this tool.
 */
export async function readTrackedTextFiles(directory: string): Promise<ActionBundleFile[]> {
  const {stdout} = await execFileAsync('git', ['ls-files', '-z', '--', '.'], {
    cwd: directory,
    maxBuffer: 64 * 1024 * 1024,
  });
  const paths = stdout.split('\0').filter((path) => path !== '' && !isExcluded(path));
  return Promise.all(paths.map((path) => readTextFile({directory, path})));
}

/** Every file below a directory that is not Git-tracked, such as an action build tree, as text. */
export async function readDirectoryTextFiles(directory: string): Promise<ActionBundleFile[]> {
  const paths: string[] = [];
  const visit = async (relative: string) => {
    const entries = await readdir(join(directory, relative), {withFileTypes: true});
    for (const entry of entries) {
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (isExcluded(path)) continue;
      if (entry.isDirectory()) await visit(path);
      else paths.push(path);
    }
  };
  await visit('');
  return Promise.all(paths.map((path) => readTextFile({directory, path})));
}

export function encodeSourceArchive(files: readonly ActionBundleFile[]) {
  return encodeActionBundle({files});
}

/** The text of a file, or `undefined` when it does not exist. */
export async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function readTextFile({
  directory,
  path,
}: {
  directory: string;
  path: string;
}): Promise<ActionBundleFile> {
  const file = join(directory, path);
  if ((await lstat(file)).isSymbolicLink()) {
    throw new Error(`${path} is a symbolic link. Source archives hold regular files only.`);
  }
  const bytes = await readFile(file);
  if (bytes.includes(0)) {
    throw new Error(`${path} is a binary file. Source archives hold text files only.`);
  }
  return {path, content: new TextDecoder('utf-8', {fatal: true}).decode(bytes)};
}

function isExcluded(path: string): boolean {
  const segments = path.split('/');
  return segments.some((segment) => excludedSegments.has(segment)) || segments.at(-1) === '.npmrc';
}
