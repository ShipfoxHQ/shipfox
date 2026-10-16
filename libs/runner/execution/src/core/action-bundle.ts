import {access, chmod, mkdir, mkdtemp, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {
  actionBundleDigestSchema,
  actionBundleDirectoryName,
  decodeActionBundle,
} from '@shipfox/workflow-document';
import {z} from 'zod';
import type {StepResult} from '#core/step-result.js';

const READ_ONLY_FILE_MODE = 0o444;
const SHARED_DIRECTORY_MODE = 0o755;
const MODULE_PACKAGE_JSON = `${JSON.stringify({type: 'module'})}\n`;

const stepActionBundlesSchema = z.array(actionBundleDigestSchema);

/** Where the bundles of a job are extracted, one directory per digest. */
export function actionsDirectory(jobTempDir: string): string {
  return join(jobTempDir, 'actions');
}

/**
 * Extracts the bundles named by `action_bundles` in the step config: the composite actions that
 * hold the step, whose files it can read under `action.path`. Returns a failed result when a
 * bundle cannot be loaded, and undefined otherwise, including for a step without bundles.
 */
export async function prepareStepActionBundle(params: {
  config: Record<string, unknown>;
  jobTempDir: string;
  load: (digest: string) => Promise<Uint8Array>;
  shared?: boolean;
}): Promise<StepResult | undefined> {
  const configured = params.config.action_bundles;
  if (configured === undefined || configured === null) return undefined;
  try {
    for (const digest of stepActionBundlesSchema.parse(configured)) {
      await prepareActionBundle({
        jobTempDir: params.jobTempDir,
        digest,
        load: () => params.load(digest),
        ...(params.shared ? {shared: true} : {}),
      });
    }
    return undefined;
  } catch (error) {
    return {
      success: false,
      error: {
        message: `The composite action files could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
        reason: 'action_unavailable',
      },
      exit_code: null,
    };
  }
}

/**
 * Extracts an action bundle once per job execution to `<job temp>/actions/<digest>/` and returns
 * that directory. `load` runs only on the first use of a digest. The digest is checked before any
 * file is written, and a partial extraction is never reused. `shared` lets any user read it, for
 * an action that runs as another user than the runner.
 */
export async function prepareActionBundle(params: {
  jobTempDir: string;
  digest: string;
  load: () => Promise<Uint8Array>;
  shared?: boolean;
}): Promise<string> {
  const actionsDir = actionsDirectory(params.jobTempDir);
  const target = join(actionsDir, actionBundleDirectoryName(params.digest));
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
    if (params.shared) await shareBundle({actionsDir, staging});
    await rename(staging, target);
  } catch (error) {
    await rm(staging, {recursive: true, force: true});
    // A concurrent step of the same job extracted the same digest first.
    if (isAlreadyExtracted(error)) return target;
    throw error;
  }
  return target;
}

// The umask cuts down the mode of every file and directory created above, and `mkdtemp` makes
// the staging directory private, so a user other than the runner's needs them opened again.
async function shareBundle(params: {actionsDir: string; staging: string}): Promise<void> {
  await chmod(params.actionsDir, SHARED_DIRECTORY_MODE);
  await chmod(params.staging, SHARED_DIRECTORY_MODE);
  const entries = await readdir(params.staging, {recursive: true, withFileTypes: true});
  for (const entry of entries) {
    await chmod(
      join(entry.parentPath, entry.name),
      entry.isDirectory() ? SHARED_DIRECTORY_MODE : READ_ONLY_FILE_MODE,
    );
  }
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
