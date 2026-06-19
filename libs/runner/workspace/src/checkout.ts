import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {CheckoutTokenAuthDto} from '@shipfox/api-workflows-dto';
import {redactSecrets, secretWireForms} from '@shipfox/redact';

const execFileAsync = promisify(execFile);

/**
 * Thrown when `git` is unusable on the runner host: absent from PATH, or older than the
 * minimum version the checkout requires. Surfaced as `git_unavailable` by the setup step.
 */
export class GitUnavailableError extends Error {
  constructor(message = 'git is not available on the runner host', options?: ErrorOptions) {
    super(message, options);
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

// Env-based config injection (GIT_CONFIG_*) requires git 2.31; older git silently ignores it,
// which would run the clone with no credential. Gate on the version so that failure surfaces
// as a clear setup error before any step runs, not as a confusing downstream auth rejection.
const MIN_GIT_VERSION = {major: 2, minor: 31} as const;

// Matches major.minor only, tolerating trailing text ("2.39.5 (Apple Git-154)", "...windows.1").
const GIT_VERSION = /git version (\d+)\.(\d+)/i;
// Anything outside printable ASCII; replaced with a space when sanitizing host-controlled output.
const NON_PRINTABLE_ASCII = /[^\x20-\x7e]/g;

/**
 * Resolves when `git` is present and at least {@link MIN_GIT_VERSION}; otherwise throws
 * {@link GitUnavailableError}. Fails closed: an unparseable `git --version` is treated as
 * unusable, since the checkout cannot prove the host supports `GIT_CONFIG_*` injection.
 */
export async function assertGitAvailable(): Promise<void> {
  let stdout: string;
  try {
    ({stdout} = await execFileAsync('git', ['--version']));
  } catch (error) {
    throw new GitUnavailableError(undefined, {cause: error});
  }

  const version = parseGitVersion(stdout);
  if (!version || !meetsMinimum(version)) {
    throw new GitUnavailableError(
      `git ${MIN_GIT_VERSION.major}.${MIN_GIT_VERSION.minor} or newer is required on the runner ` +
        'host (the checkout credential is injected via GIT_CONFIG_* environment variables, ' +
        `supported since git ${MIN_GIT_VERSION.major}.${MIN_GIT_VERSION.minor}); found ` +
        describeGitVersion(stdout),
    );
  }
}

function parseGitVersion(output: string): {major: number; minor: number} | undefined {
  const match = GIT_VERSION.exec(output);
  if (!match) return undefined;
  return {major: Number(match[1]), minor: Number(match[2])};
}

function meetsMinimum(version: {major: number; minor: number}): boolean {
  if (version.major !== MIN_GIT_VERSION.major) return version.major > MIN_GIT_VERSION.major;
  return version.minor >= MIN_GIT_VERSION.minor;
}

// `git --version` output is host-controlled (a wrapper or shim on PATH can emit anything), and
// this string lands in a logged step-error message. Keep only printable ASCII and bound the
// length so control bytes or a megabyte of garbage cannot poison the log.
function describeGitVersion(output: string): string {
  const sanitized = output.replace(NON_PRINTABLE_ASCII, ' ').trim().slice(0, 80);
  return sanitized ? `"${sanitized}"` : 'an unrecognized version';
}

// git surfaces credential rejection and provider-availability failures only through
// stderr text, so classification is pattern-based. Auth wins over unavailable when both
// could match, since a rejected credential is the more actionable cause.
const AUTH_FAILURE =
  /authentication failed|could not read username|invalid username or password|terminal prompts disabled|403 forbidden|the requested url returned error: 40[13]|permission denied \(publickey\)|access denied/i;
const PROVIDER_UNAVAILABLE =
  /could not resolve host|could not connect|connection timed out|failed to connect|temporary failure in name resolution|the requested url returned error: (?:429|5\d\d)/i;

const GIT_CONFIG_INDEXED_KEY = /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/;

// Git reads injected config from two environment channels: the GIT_CONFIG_COUNT /
// GIT_CONFIG_KEY_<n> / GIT_CONFIG_VALUE_<n> triples, and GIT_CONFIG_PARAMETERS (the channel
// `-c` populates internally). Strip both from every git child so our injected header is the
// only env-sourced config and a clone behaves identically regardless of the host environment.
function gitChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {...process.env, GIT_TERMINAL_PROMPT: '0'};
  for (const key of Object.keys(env)) {
    if (GIT_CONFIG_INDEXED_KEY.test(key)) delete env[key];
  }
  delete env.GIT_CONFIG_PARAMETERS;
  return env;
}

/**
 * Shallow-clones `ref` of `repositoryUrl` into `cwd` (which must already exist and be empty).
 *
 * The credential rides a process-scoped `GIT_CONFIG_*` environment pair (`http.extraHeader`),
 * never a CLI argument and never embedded in the clone URL. This keeps it out of the process
 * argv (so it cannot be read via `ps` / `/proc/<pid>/cmdline` while the clone runs) and out of
 * `.git/config`, where a later user step could read it. The child environment is first
 * sanitized of any inherited git config-injection channels (see {@link gitChildEnv}).
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

  const args = ['clone', '--depth=1', '--single-branch', '--branch', ref, repositoryUrl, cwd];

  const env = gitChildEnv();
  if (auth) {
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.extraHeader';
    env.GIT_CONFIG_VALUE_0 = `Authorization: ${authorizationValue(auth)}`;
  }

  try {
    await execFileAsync('git', args, {env, ...(signal ? {signal} : {})});
  } catch (error) {
    throw classifyCloneError(error, auth);
  }
}

function basicCredential(auth: {username: string; token: string}): string {
  return Buffer.from(`${auth.username}:${auth.token}`).toString('base64');
}

function authorizationValue(auth: CheckoutTokenAuthDto): string {
  if (auth.kind === 'bearer') return `Bearer ${auth.token}`;
  return `Basic ${basicCredential(auth)}`;
}

// Every form the credential takes on the wire is secret. `secretWireForms` derives the token's
// encoded variants (base64/base64url/hex/url-encoded); the Basic header carries
// `base64(username:token)`, which is not a wire form of the token alone, so add it explicitly.
function secretsOf(auth: CheckoutTokenAuthDto | undefined): string[] {
  if (!auth) return [];
  if (auth.kind === 'bearer') return secretWireForms(auth.token);
  return [...secretWireForms(auth.token), basicCredential(auth)];
}

function classifyCloneError(error: unknown, auth: CheckoutTokenAuthDto | undefined): CheckoutError {
  if (isAbortError(error)) {
    return new CheckoutError('aborted', 'Checkout aborted', {cause: error});
  }

  const secrets = secretsOf(auth);
  const stderr = stderrOf(error);
  const message = redactSecrets(stderr.trim() || errorMessage(error), secrets);
  // Defense in depth: the credential no longer rides argv, but git stderr can still echo a
  // credential-bearing URL, so scrub the cause too before it can reach a logger.
  const cause = secrets.length > 0 ? redactedCause(error, secrets) : error;

  if (AUTH_FAILURE.test(stderr)) return new CheckoutError('auth', message, {cause});
  if (PROVIDER_UNAVAILABLE.test(stderr)) {
    return new CheckoutError('unavailable', message, {cause});
  }
  return new CheckoutError('failed', message, {cause});
}

// Rebuilds the failure cause with every secret stripped from its message, preserving the
// original error name for diagnostics while guaranteeing no credential survives on it.
function redactedCause(error: unknown, secrets: string[]): Error {
  const scrubbed = new Error(redactSecrets(errorMessage(error), secrets));
  if (error instanceof Error) scrubbed.name = error.name;
  return scrubbed;
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
