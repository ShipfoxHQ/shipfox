import {execFile} from 'node:child_process';
import {lstat, readFile} from 'node:fs/promises';
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

  return Promise.all(
    paths.map(async (path) => {
      const file = join(directory, path);
      if ((await lstat(file)).isSymbolicLink()) {
        throw new Error(`${path} is a symbolic link. Source archives hold regular files only.`);
      }
      const bytes = await readFile(file);
      if (bytes.includes(0)) {
        throw new Error(`${path} is a binary file. Source archives hold text files only.`);
      }
      return {path, content: new TextDecoder('utf-8', {fatal: true}).decode(bytes)};
    }),
  );
}

export function encodeSourceArchive(files: readonly ActionBundleFile[]) {
  return encodeActionBundle({files});
}

function isExcluded(path: string): boolean {
  const segments = path.split('/');
  return segments.some((segment) => excludedSegments.has(segment)) || segments.at(-1) === '.npmrc';
}
