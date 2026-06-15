import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {CheckoutTokenAuthDto} from '@shipfox/api-workflows-dto';

const execFileAsync = promisify(execFile);

/** Thrown when `git` is not on the runner host's PATH; surfaced as `git_unavailable`. */
export class GitUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super('git is not available on the runner host', options);
    this.name = 'GitUnavailableError';
  }
}

/**
 * Why a clone failed, kept abstract here so the workspace layer does not depend on the
 * step-error DTO. The setup step maps each kind to a machine-readable `reason`.
 */
export type CheckoutFailureKind = 'auth' | 'unavailable' | 'failed' | 'aborted';

export class CheckoutError extends Error {
  constructor(
    public readonly kind: CheckoutFailureKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CheckoutError';
  }
}

/** Throws {@link GitUnavailableError} when `git` cannot be invoked on the host. */
export async function assertGitAvailable(): Promise<void> {
  try {
    await execFileAsync('git', ['--version']);
  } catch (error) {
    throw new GitUnavailableError({cause: error});
  }
}

/**
 * Removes every occurrence of each secret plus any URL-embedded `user:pass@` credential
 * from `text`, so a clone error never carries token material into a log or step result.
 */
export function redactSecrets(text: string, secrets: string[]): string {
  let redacted = text;
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join('***');
  }
  return redacted.replace(/(https?:\/\/)[^/@\s]+@/gi, '$1***@');
}

// git surfaces credential rejection and provider-availability failures only through
// stderr text, so classification is pattern-based. Auth wins over unavailable when both
// could match, since a rejected credential is the more actionable cause.
const AUTH_FAILURE =
  /authentication failed|could not read username|invalid username or password|terminal prompts disabled|403 forbidden|permission denied \(publickey\)|access denied/i;
const PROVIDER_UNAVAILABLE =
  /could not resolve host|could not connect|connection timed out|failed to connect|temporary failure in name resolution/i;

/**
 * Shallow-clones `ref` of `repositoryUrl` into `cwd` (which must already exist and be empty).
 *
 * The credential is injected with a one-shot `-c http.extraHeader`, never embedded in the
 * clone URL, so it is not persisted to `.git/config` where later user steps could read it.
 * `GIT_TERMINAL_PROMPT=0` turns a missing or denied credential into an immediate error
 * instead of a hang on an interactive prompt. Failures are classified into a
 * {@link CheckoutError} and have any token material redacted from their message.
 */
export async function checkoutRepository(params: {
  repositoryUrl: string;
  ref: string;
  auth?: CheckoutTokenAuthDto | undefined;
  cwd: string;
  signal?: AbortSignal | undefined;
}): Promise<void> {
  const {repositoryUrl, ref, auth, cwd, signal} = params;

  const args: string[] = [];
  if (auth) {
    args.push('-c', `http.extraHeader=Authorization: ${authorizationValue(auth)}`);
  }
  args.push('clone', '--depth=1', '--single-branch', '--branch', ref, repositoryUrl, cwd);

  try {
    await execFileAsync('git', args, {
      env: {...process.env, GIT_TERMINAL_PROMPT: '0'},
      ...(signal ? {signal} : {}),
    });
  } catch (error) {
    throw classifyCloneError(error, auth?.token);
  }
}

function authorizationValue(auth: CheckoutTokenAuthDto): string {
  if (auth.kind === 'bearer') return `Bearer ${auth.token}`;
  const basic = Buffer.from(`${auth.username}:${auth.token}`).toString('base64');
  return `Basic ${basic}`;
}

function classifyCloneError(error: unknown, token: string | undefined): CheckoutError {
  if (isAbortError(error)) {
    return new CheckoutError('aborted', 'Checkout aborted', {cause: error});
  }

  const stderr = stderrOf(error);
  const message = redactSecrets(stderr.trim() || errorMessage(error), token ? [token] : []);

  if (AUTH_FAILURE.test(stderr)) return new CheckoutError('auth', message, {cause: error});
  if (PROVIDER_UNAVAILABLE.test(stderr)) {
    return new CheckoutError('unavailable', message, {cause: error});
  }
  return new CheckoutError('failed', message, {cause: error});
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function stderrOf(error: unknown): string {
  if (error && typeof error === 'object' && 'stderr' in error) {
    const {stderr} = error as {stderr?: unknown};
    if (typeof stderr === 'string') return stderr;
    if (Buffer.isBuffer(stderr)) return stderr.toString();
  }
  return '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
