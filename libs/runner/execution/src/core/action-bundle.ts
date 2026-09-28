import {access, mkdir, mkdtemp, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {decodeActionBundle} from '@shipfox/workflow-document';

const READ_ONLY_FILE_MODE = 0o444;
const MODULE_PACKAGE_JSON = `${JSON.stringify({type: 'module'})}\n`;

/**
 * Extracts an action bundle once per job execution to `<job temp>/actions/<digest>/` and returns
 * that directory. `load` runs only on the first use of a digest. The digest is checked before any
 * file is written, and a partial extraction is never reused.
 */
export async function prepareActionBundle(params: {
  jobTempDir: string;
  digest: string;
  load: () => Promise<Uint8Array>;
}): Promise<string> {
  const actionsDir = join(params.jobTempDir, 'actions');
  const target = join(actionsDir, params.digest.replace(':', '-'));
  if (await exists(target)) return target;

  const files = await decodeActionBundle({gzip: await params.load(), digest: params.digest});
  await mkdir(actionsDir, {recursive: true});
  const staging = await mkdtemp(join(actionsDir, '.extract-'));
  try {
    for (const file of files) {
      const path = join(staging, file.path);
      await mkdir(dirname(path), {recursive: true});
      await writeFile(path, file.content, {mode: READ_ONLY_FILE_MODE});
    }
    // The action entry is ESM whatever the bundle says, unless the bundle brings its own package.json.
    if (!files.some((file) => file.path === 'package.json')) {
      await writeFile(join(staging, 'package.json'), MODULE_PACKAGE_JSON, {
        mode: READ_ONLY_FILE_MODE,
      });
    }
    await rename(staging, target);
  } catch (error) {
    await rm(staging, {recursive: true, force: true});
    // A concurrent step of the same job extracted the same digest first.
    if (isAlreadyExtracted(error)) return target;
    throw error;
  }
  return target;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isAlreadyExtracted(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EEXIST' || code === 'ENOTEMPTY';
}
