import {mkdir, rm} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import {join, parse, resolve} from 'node:path';
import {logger} from '@shipfox/node-opentelemetry';

/**
 * Thrown when `SHIPFOX_RUNNER_WORKSPACE_ROOT` resolves to a path we refuse to
 * manage per-job directories under (empty, the filesystem root, or a home
 * directory). Surfaced at startup so the operator catches the misconfig at
 * deploy rather than as silent per-job failures.
 */
export class UnsafeWorkspaceRootError extends Error {
  constructor(public readonly root: string) {
    super(`Unsafe workspace root: ${root || '(empty)'}`);
    this.name = 'UnsafeWorkspaceRootError';
  }
}

/**
 * Thrown when a job's id is not the UUID the API contract guarantees, so it
 * cannot be used as the per-job directory name.
 */
export class InvalidJobIdError extends Error {
  constructor(public readonly jobId: string) {
    super(`Invalid job id: ${jobId}`);
    this.name = 'InvalidJobIdError';
  }
}

export interface WorkspaceConfig {
  SHIPFOX_RUNNER_WORKSPACE_ROOT?: string | undefined;
}

/**
 * Falls back to the OS temp directory when no root is configured. Only a
 * configured root is validated (throws {@link UnsafeWorkspaceRootError}); the
 * temp fallback is trusted.
 */
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

// The job id is the only input to the per-job path; assert it is the UUID the
// API contract guarantees rather than munging it, so a malformed id fails the
// job loudly instead of silently reshaping the directory name.
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pre-cleans the per-job directory before creating it, so a directory left by a
 * previous crash is never reused. Throws when the job id is not the UUID the
 * API contract guarantees, since it is the only input to the directory path.
 */
export async function prepareWorkspace(job: {job_id: string}, root: string): Promise<Workspace> {
  if (!JOB_ID_PATTERN.test(job.job_id)) {
    throw new InvalidJobIdError(job.job_id);
  }

  const cwd = join(root, `job-${job.job_id}`);

  // Pre-clean the per-job directory only — never the configured root.
  await rm(cwd, {recursive: true, force: true});
  await mkdir(cwd, {recursive: true});

  return {cwd, cleanup: () => cleanupWorkspace(cwd)};
}

/**
 * Never throws: failures are logged and swallowed so a dirty directory can't
 * mask the job result; the next prepareWorkspace pre-clean reclaims it.
 */
export async function cleanupWorkspace(cwd: string): Promise<void> {
  try {
    await rm(cwd, {recursive: true, force: true});
  } catch (err) {
    logger().warn({err, cwd}, 'Failed to clean up job workspace');
  }
}
