import {execFile} from 'node:child_process';
import {cp, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {promisify} from 'node:util';
import {getWorkspaceRootPath, overlayBuiltOutputs} from '@shipfox/tool-utils';

const execFileAsync = promisify(execFile);

const COMMAND_TIMEOUT_MS = 300_000;
const COMMAND_MAX_BUFFER = 16 * 1024 * 1024;
const RUNNER_PACKAGE = '@shipfox/runner';

export interface DeployRunnerParams {
  /** Directory that receives the installation. It must not exist yet. */
  installDir: string;
}

async function run(command: string, args: string[], cwd: string): Promise<void> {
  try {
    await execFileAsync(command, args, {
      cwd,
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: COMMAND_MAX_BUFFER,
    });
  } catch (error) {
    const {stdout = '', stderr = ''} = error as {stdout?: string; stderr?: string};
    throw new Error(`${command} ${args.join(' ')} failed.\n${stdout}\n${stderr}`, {cause: error});
  }
}

/**
 * Deploys `@shipfox/runner` with its production dependency closure into one directory,
 * the layout of the runner image. A job container mounts the runner installation, so a
 * container job needs this layout: a runner started from source keeps its packages
 * outside `apps/runner`, where the container cannot reach them.
 *
 * The steps are those of the runner image build: prune the workspace, overlay the built
 * `dist/` directories, then `pnpm deploy`. The deploy runs from the pruned copy because
 * it records a production-only install in the workspace it runs from, and the next
 * `pnpm run` there would reinstall without development dependencies.
 *
 * The runner and its workspace dependencies must be built first. Under Turbo this is
 * automatic: `test:e2e` depends on `^build`, and this package depends on `@shipfox/runner`.
 */
export async function deployRunner(params: DeployRunnerParams): Promise<string> {
  const workspaceRoot = getWorkspaceRootPath();
  if (!workspaceRoot) throw new Error('Unable to determine the workspace root.');
  const installDir = resolve(params.installDir);
  const pruned = await mkdtemp(join(tmpdir(), 'shipfox-e2e-runner-prune-'));
  try {
    await run('turbo', ['prune', '--docker', '--out-dir', pruned, RUNNER_PACKAGE], workspaceRoot);
    const prunedRoot = join(pruned, 'full');
    // `full` has the sources and `json` has the lockfile, as the image build copies them.
    // The overlay comes last because it rewrites the manifests for the built output.
    await cp(join(pruned, 'json'), prunedRoot, {recursive: true});
    overlayBuiltOutputs({prunedRoot, workspaceRoot});
    // The flags match the deploy in apps/runner/Dockerfile.
    await run(
      'pnpm',
      [
        `--filter=${RUNNER_PACKAGE}`,
        'deploy',
        '--prod',
        '--legacy',
        '--config.strict-peer-dependencies=false',
        installDir,
      ],
      prunedRoot,
    );
  } finally {
    await rm(pruned, {recursive: true, force: true});
  }
  return installDir;
}
