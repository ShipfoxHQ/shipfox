import {mkdir, rm} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join, parse, resolve} from 'node:path';
import {logger} from '@shipfox/node-opentelemetry';

// Thrown when SHIPFOX_RUNNER_WORKSPACE_ROOT resolves to a path we refuse to
// manage per-job directories under: an empty value, the filesystem root, or a
// home directory. Validated once at startup so the operator sees the misconfig
// at deploy time rather than as silent per-job failures.
export class UnsafeWorkspaceRootError extends Error {
  constructor(public readonly root: string) {
    super(`Unsafe workspace root: ${root || '(empty)'}`);
    this.name = 'UnsafeWorkspaceRootError';
  }
}

export interface WorkspaceConfig {
  SHIPFOX_RUNNER_WORKSPACE_ROOT?: string | undefined;
}

// Resolve the parent directory for per-job workspaces. Returns the configured
// root (validated) when set, otherwise the OS temp directory. The temp
// fallback is trusted and not validated against the unsafe-path rules.
export function resolveWorkspaceRoot(config: WorkspaceConfig): string {
  const configured = config.SHIPFOX_RUNNER_WORKSPACE_ROOT;

  if (configured === undefined) return tmpdir();

  if (configured.trim() === '') throw new UnsafeWorkspaceRootError(configured);

  const resolved = resolve(configured);

  // A filesystem root ('/' on POSIX, 'C:\\' on Windows) has no parent and would
  // put job dirs at the top level — never manage cleanup there.
  if (resolved === parse(resolved).root) throw new UnsafeWorkspaceRootError(configured);

  // The home directory holds the operator's files; a stray recursive cleanup
  // there would be catastrophic.
  if (resolved === resolve(homedir())) throw new UnsafeWorkspaceRootError(configured);

  return resolved;
}

export interface Workspace {
  cwd: string;
  cleanup(): Promise<void>;
}

// Create a fresh per-job directory under `root` and return its path plus a
// cleanup handle. The directory name is derived only from the job id (a
// server-assigned UUID), sanitized to a conservative character set so no
// user-controlled path fragment can ever appear. The per-job directory is
// pre-cleaned before creation so a leftover directory from a previous crash is
// never reused.
export async function prepareWorkspace(job: {job_id: string}, root: string): Promise<Workspace> {
  const segment = job.job_id.replace(/[^A-Za-z0-9-]/g, '');
  const cwd = join(root, `shipfox-job-${segment}`);

  // Pre-clean the per-job directory only — never the configured root.
  await rm(cwd, {recursive: true, force: true});
  await mkdir(cwd, {recursive: true});

  return {cwd, cleanup: () => cleanupWorkspace(cwd)};
}

// Remove a per-job directory. Cleanup failures are logged and swallowed: a
// dirty directory must never mask the job result, and the next job's
// prepareWorkspace pre-clean will reclaim it.
export async function cleanupWorkspace(cwd: string): Promise<void> {
  try {
    await rm(cwd, {recursive: true, force: true});
  } catch (err) {
    logger().warn({err, cwd}, 'Failed to clean up job workspace');
  }
}
