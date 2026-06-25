import {arch, platform, release} from 'node:os';
import type {CheckoutTokenResponseDto, StepErrorReason} from '@shipfox/api-workflows-dto';
import {HTTPError, requestCheckoutToken} from '@shipfox/runner-protocol';
import {
  assertGitAvailable,
  type CheckoutCommandStartMetadata,
  CheckoutError,
  type CheckoutFailureKind,
  type CheckoutOutputSink,
  type CheckoutPhase,
  checkoutRepository,
  createJobDir,
} from '@shipfox/runner-workspace';
import type {KyInstance} from 'ky';
import type {StepResult} from '#core/step-result.js';

const URL_CREDENTIAL_RE = /(https?:\/\/)[^/@\s]+@/gi;

interface SetupLogSink {
  writeGroupStart(name: string): void;
  writeGroupEnd(): void;
  writeGroup(options: {name: string; lines: readonly string[]; source?: 'stdout' | 'stderr'}): void;
  writeOutputLine(line: string, source?: 'stdout' | 'stderr'): void;
  write(chunk: Buffer, source: 'stdout' | 'stderr'): void;
  addSecrets(secrets: string[]): void;
}

export interface SetupJobContext {
  jobId: string;
  runId: string;
}

// The synthetic "Set up job" step body. It owns per-job workspace preparation and the
// repository checkout, reporting failures through the normal step protocol so a setup
// failure fails the job in seconds instead of hanging until the lease expires.
//
// Abort handling lives in the step loop, not here: an aborted job stops the loop before
// it reports (see step-loop.ts), exactly like an abort during any step. The git child is
// still killed via `signal`, and the per-job workspace is cleaned up in runJob's finally.
export async function executeSetupStep(params: {
  cwd: string;
  leaseClient: KyInstance;
  signal: AbortSignal;
  log?: SetupLogSink | undefined;
  jobContext?: SetupJobContext | undefined;
}): Promise<StepResult> {
  const {cwd, leaseClient, signal, log, jobContext} = params;

  writeJobContext(log, jobContext);

  const gitFailure = await checkGit(log);
  if (gitFailure) return gitFailure;

  const workspaceFailure = await prepareWorkspace({cwd, log});
  if (workspaceFailure) return workspaceFailure;

  const checkoutFailure = await runCheckoutSetup({cwd, leaseClient, signal, log});
  if (checkoutFailure) return checkoutFailure;

  log?.writeOutputLine('Setup completed successfully.');
  return {success: true, error: null, exit_code: 0};
}

async function checkGit(log: SetupLogSink | undefined): Promise<StepResult | null> {
  try {
    const gitVersion = await assertGitAvailable();
    writeRunnerEnvironment(log, gitVersion);
    return null;
  } catch (error) {
    writeRunnerEnvironment(log, 'unavailable');
    log?.writeOutputLine(
      `Setup failed during git availability check: ${messageOf(error)}`,
      'stderr',
    );
    return fail(error, 'git_unavailable');
  }
}

async function prepareWorkspace(params: {
  cwd: string;
  log?: SetupLogSink | undefined;
}): Promise<StepResult | null> {
  const {cwd, log} = params;
  try {
    log?.writeGroup({
      name: 'Prepare workspace',
      lines: [
        `workspace: ${cwd}`,
        'operation: remove any previous job directory and create a clean checkout directory',
      ],
    });
    await createJobDir(cwd);
  } catch (error) {
    log?.writeOutputLine(
      `Setup failed during workspace preparation: ${messageOf(error)}`,
      'stderr',
    );
    return fail(error, 'workspace_prep_failed');
  }
  return null;
}

async function runCheckoutSetup(params: {
  cwd: string;
  leaseClient: KyInstance;
  signal: AbortSignal;
  log?: SetupLogSink | undefined;
}): Promise<StepResult | null> {
  const {log} = params;
  log?.writeGroupStart('Checkout');
  try {
    const checkout = await requestCheckoutCredentials(params);
    if (!checkout.ok) return checkout.result;

    return await checkoutRepositoryForSetup({...params, checkout: checkout.value});
  } finally {
    log?.writeGroupEnd();
  }
}

type SetupPhaseResult<T> = {ok: true; value: T} | {ok: false; result: StepResult};

async function requestCheckoutCredentials(params: {
  leaseClient: KyInstance;
  signal: AbortSignal;
  log?: SetupLogSink | undefined;
}): Promise<SetupPhaseResult<CheckoutTokenResponseDto>> {
  const {leaseClient, signal, log} = params;
  try {
    log?.writeGroup({
      name: 'Request checkout credentials',
      lines: ['Requesting checkout credentials'],
    });
    const checkout = await requestCheckoutToken(leaseClient, {signal});
    log?.writeGroup({
      name: 'Checkout authentication',
      lines: [
        checkout.auth ? `credential kind: ${checkout.auth.kind}` : 'credential kind: none',
        checkout.auth?.expires_at ? `expires at: ${checkout.auth.expires_at}` : 'expires at: n/a',
      ],
    });
    return {ok: true, value: checkout};
  } catch (error) {
    log?.writeOutputLine(
      `Setup failed while requesting checkout credentials: ${messageOf(error)}`,
      'stderr',
    );
    return {ok: false, result: fail(error, classifyCheckoutTokenError(error))};
  }
}

async function checkoutRepositoryForSetup(params: {
  cwd: string;
  checkout: CheckoutTokenResponseDto;
  signal: AbortSignal;
  log?: SetupLogSink | undefined;
}): Promise<StepResult | null> {
  const {cwd, checkout, signal, log} = params;
  try {
    log?.writeGroup({
      name: 'Checkout repository',
      lines: [`repository: ${safeRepositoryUrl(checkout.repository_url)}`, `ref: ${checkout.ref}`],
    });
    const commit = await checkoutRepository({
      repositoryUrl: checkout.repository_url,
      ref: checkout.ref,
      auth: checkout.auth,
      cwd,
      signal,
      onSecrets: (secrets) => log?.addSecrets(secrets),
      onCommandStart: (metadata) => writeCheckoutCommand(log, metadata),
      onOutput: checkoutOutput(log),
    });
    log?.writeGroup({name: 'Checkout complete', lines: [`checked-out commit: ${commit}`]});
    return null;
  } catch (error) {
    const reason =
      error instanceof CheckoutError ? CHECKOUT_KIND_REASON[error.kind] : 'checkout_failed';
    if (error instanceof CheckoutError && error.phase) {
      log?.writeOutputLine(
        `Setup failed during checkout ${phaseLabel(error.phase)}: ${messageOf(error)}`,
        'stderr',
      );
    } else {
      log?.writeOutputLine(`Setup failed during checkout: ${messageOf(error)}`, 'stderr');
    }
    return fail(error, reason);
  }
}

const CHECKOUT_KIND_REASON: Record<CheckoutFailureKind, StepErrorReason> = {
  auth: 'checkout_auth_failed',
  unavailable: 'checkout_unavailable',
  failed: 'checkout_failed',
  aborted: 'setup_aborted',
};

// Maps a checkout-token endpoint failure to a reason. Auth denial and the backend's
// retryable provider signals (429/503, or their typed `code`) get distinct reasons; a
// missing checkout intent (404) and everything else fold into the generic failure.
// CheckoutError messages are already redacted in the workspace layer; the token-fetch
// error never carries credential material.
function classifyCheckoutTokenError(error: unknown): StepErrorReason {
  if (!(error instanceof HTTPError)) return 'checkout_failed';

  const {status} = error.response;
  const code = readErrorCode(error);

  if (status === 401 || status === 403 || code === 'access-denied' || code === 'forbidden') {
    return 'checkout_auth_failed';
  }
  if (
    status === 429 ||
    status === 503 ||
    code === 'rate-limited' ||
    code === 'timeout' ||
    code === 'provider-unavailable'
  ) {
    return 'checkout_unavailable';
  }
  return 'checkout_failed';
}

// ky consumes the response body to populate `error.data` before throwing, so the body
// is already read here: `error.response.json()` would throw "Body has already been
// consumed". Read ky's pre-parsed `data` instead.
function readErrorCode(error: HTTPError): string | undefined {
  const body = error.data;
  if (body && typeof body === 'object' && 'code' in body && typeof body.code === 'string') {
    return body.code;
  }
  return undefined;
}

function fail(error: unknown, reason: StepErrorReason): StepResult {
  return {
    success: false,
    error: {message: messageOf(error), reason},
    exit_code: null,
  };
}

function writeJobContext(
  log: SetupLogSink | undefined,
  jobContext: SetupJobContext | undefined,
): void {
  if (!jobContext) return;
  log?.writeGroup({
    name: 'Job context',
    lines: [`job id: ${jobContext.jobId}`, `run id: ${jobContext.runId}`],
  });
}

function writeRunnerEnvironment(log: SetupLogSink | undefined, gitVersion: string): void {
  log?.writeGroup({
    name: 'Runner environment',
    lines: [
      `node: ${process.version}`,
      `os: ${platform()} ${release()}`,
      `architecture: ${arch()}`,
      `git: ${gitVersion}`,
      ...buildMetadataLines(),
    ],
  });
}

function buildMetadataLines(): string[] {
  const lines: string[] = [];
  if (process.env.npm_package_version)
    lines.push(`package version: ${process.env.npm_package_version}`);
  if (process.env.IMAGE_REVISION) lines.push(`image revision: ${process.env.IMAGE_REVISION}`);
  if (process.env.BUILD_NUMBER) lines.push(`build number: ${process.env.BUILD_NUMBER}`);
  return lines;
}

function writeCheckoutCommand(
  log: SetupLogSink | undefined,
  metadata: CheckoutCommandStartMetadata,
): void {
  log?.writeGroup({
    name: `Checkout ${phaseLabel(metadata.phase)}`,
    lines: [metadata.command, `working-directory: ${metadata.cwd}`],
  });
}

function checkoutOutput(log: SetupLogSink | undefined): CheckoutOutputSink | undefined {
  if (!log) return undefined;
  return (chunk, source) => log.write(chunk, source);
}

function phaseLabel(phase: CheckoutPhase): string {
  return phase.replace('-', ' ');
}

function safeRepositoryUrl(repositoryUrl: string): string {
  return repositoryUrl.replace(URL_CREDENTIAL_RE, '$1***@');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
