import type {CheckoutTokenResponseDto, StepErrorReasonDto} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {classifyCheckoutTokenFailure, requestCheckoutToken} from '@shipfox/runner-protocol';
import {
  ambientGitCredentialSecrets,
  type CheckoutCommandStartMetadata,
  CheckoutError,
  type CheckoutFailureKind,
  type CheckoutOutputSink,
  type CheckoutPhase,
  type CheckoutRetryEvent,
  checkoutRepository,
  type GitCredentialHelperConfig,
  type PersistedCheckoutCredential,
  writeAmbientGitCredential,
} from '@shipfox/runner-workspace';
import type {KyInstance} from 'ky';
import type {StepResult} from '#core/step-result.js';

const URL_CREDENTIAL_RE = /(https?:\/\/)[^/@\s]+@/gi;

export interface CheckoutLogSink {
  writeGroupStart(name: string): void;
  writeGroupEnd(): void;
  writeGroup(options: {name: string; lines: readonly string[]; source?: 'stdout' | 'stderr'}): void;
  writeOutputLine(line: string, source?: 'stdout' | 'stderr'): void;
  write(chunk: Buffer, source: 'stdout' | 'stderr'): void;
  addSecrets(secrets: string[]): void;
}

export type CheckoutFailureScope = 'setup' | 'checkout';

export type CheckoutPhaseResult<T> = {ok: true; value: T} | {ok: false; result: StepResult};

export async function requestCheckoutCredentials(params: {
  leaseClient: KyInstance;
  signal: AbortSignal;
  stepId: string;
  attempt: number;
  log?: CheckoutLogSink | undefined;
  scope: CheckoutFailureScope;
}): Promise<CheckoutPhaseResult<CheckoutTokenResponseDto>> {
  const {leaseClient, signal, stepId, attempt, log, scope} = params;
  try {
    log?.writeGroup({
      name: 'Request repository access',
      lines: ['Requesting short-lived repository access from Shipfox.'],
    });
    const checkout = await requestCheckoutToken(leaseClient, {stepId, attempt, signal});
    if (checkout.auth) log?.addSecrets(ambientGitCredentialSecrets(checkout.auth));
    log?.writeGroup({
      name: 'Repository access granted',
      lines: credentialLines(checkout.auth),
    });
    return {ok: true, value: checkout};
  } catch (error) {
    const reason = CHECKOUT_KIND_REASON[classifyCheckoutTokenFailure(error)];
    writeFailure(
      log,
      scope === 'setup'
        ? 'Setup failed because Shipfox could not grant repository access.'
        : 'Checkout step failed because Shipfox could not grant repository access.',
      checkoutTokenFailureHelp(reason),
      error,
    );
    return {ok: false, result: fail(error, reason)};
  }
}

export async function checkoutRepositoryAt(params: {
  destination: string;
  gitConfigPath: string;
  checkout: CheckoutTokenResponseDto;
  checkoutStepId: string;
  checkoutAttempt: number;
  signal: AbortSignal;
  log?: CheckoutLogSink | undefined;
  scope: CheckoutFailureScope;
  credentialHelper?: GitCredentialHelperConfig | undefined;
}): Promise<
  CheckoutPhaseResult<{
    ambientGitConfigPath?: string | undefined;
    ambientGitConfigSecrets?: string[] | undefined;
    persistedCheckoutCredential?: PersistedCheckoutCredential | undefined;
    checkout: NonNullable<StepResult['checkout']>;
  }>
> {
  const {
    destination,
    gitConfigPath,
    checkout,
    checkoutStepId,
    checkoutAttempt,
    signal,
    log,
    scope,
    credentialHelper,
  } = params;
  try {
    log?.writeGroup({
      name: 'Repository details',
      lines: [
        `Repository: ${safeRepositoryUrl(checkout.repository_url)}`,
        `Requested ref: ${checkout.ref}`,
        `Path: ${destination}`,
      ],
    });
    const commit = await checkoutRepository({
      repositoryUrl: checkout.repository_url,
      ref: checkout.ref,
      fetchDepth: checkout.fetch_depth,
      auth: checkout.auth,
      cwd: destination,
      signal,
      onSecrets: (secrets) => log?.addSecrets(secrets),
      onCommandStart: (metadata) => writeCheckoutCommand(log, metadata),
      onOutput: checkoutOutput(log),
      onRetry: (event) => writeCheckoutRetryLog(log, event),
    });
    log?.writeGroup({name: 'Checkout complete', lines: [`Checked out commit: ${commit}`]});
    const ambientGitConfig = await persistAmbientGitCredential({
      gitConfigPath,
      checkout,
      log,
      scope,
      checkoutStepId,
      checkoutAttempt,
      ...credentialHelperOptions(credentialHelper),
    });
    return {
      ok: true,
      value: checkoutPhaseValue({checkout, destination, commit, ambientGitConfig}),
    };
  } catch (error) {
    return checkoutFailureResult({error, log, scope});
  }
}

async function persistAmbientGitCredential(params: {
  gitConfigPath: string;
  checkout: CheckoutTokenResponseDto;
  log?: CheckoutLogSink | undefined;
  scope: CheckoutFailureScope;
  checkoutStepId: string;
  checkoutAttempt: number;
  credentialHelper?: GitCredentialHelperConfig | undefined;
}): Promise<
  | {
      path: string;
      secrets: string[];
      persistedCheckoutCredential?: PersistedCheckoutCredential | undefined;
    }
  | undefined
> {
  const {gitConfigPath, checkout, log, scope, checkoutStepId, checkoutAttempt, credentialHelper} =
    params;
  const auth = checkout.auth;
  const shouldPersistCredential = auth?.persist === true && auth.carry === 'header';
  if (!shouldPersistCredential && checkout.git_author === undefined) return undefined;
  const persistedCheckoutCredential =
    credentialHelper === undefined || !shouldPersistCredential
      ? undefined
      : persistedCheckoutCredentialFromCheckout({checkout, checkoutStepId, checkoutAttempt});

  try {
    await writeAmbientGitCredential({
      configPath: gitConfigPath,
      repositoryUrl: checkout.repository_url,
      ...credentialHelperOptions(persistedCheckoutCredential ? credentialHelper : undefined),
      ...authOptions({auth, shouldPersistCredential, persistedCheckoutCredential}),
      ...(checkout.git_author ? {gitAuthor: checkout.git_author} : {}),
    });
    return {
      path: gitConfigPath,
      secrets:
        persistedCheckoutCredential === undefined && shouldPersistCredential && auth
          ? ambientGitCredentialSecrets(auth)
          : [],
      ...(persistedCheckoutCredential ? {persistedCheckoutCredential} : {}),
    };
  } catch (error) {
    writeWarning(
      log,
      'Repository access was not persisted',
      [
        `The checkout succeeded, but agent and run steps will run without ambient git authentication. Details: ${messageOf(error)}`,
        'Git commands in later steps may need their own credentials.',
      ],
      scope,
    );
    return undefined;
  }
}

function checkoutPhaseValue(params: {
  checkout: CheckoutTokenResponseDto;
  destination: string;
  commit: string;
  ambientGitConfig:
    | {
        path: string;
        secrets: string[];
        persistedCheckoutCredential?: PersistedCheckoutCredential | undefined;
      }
    | undefined;
}): {
  ambientGitConfigPath?: string | undefined;
  ambientGitConfigSecrets?: string[] | undefined;
  persistedCheckoutCredential?: PersistedCheckoutCredential | undefined;
  checkout: NonNullable<StepResult['checkout']>;
} {
  const {checkout, destination, commit, ambientGitConfig} = params;
  return {
    checkout: {
      repository: checkout.repository_url,
      ref: checkout.ref,
      commit,
      path: destination,
    },
    ...(ambientGitConfig
      ? {
          ambientGitConfigPath: ambientGitConfig.path,
          ambientGitConfigSecrets: ambientGitConfig.secrets,
          ...(ambientGitConfig.persistedCheckoutCredential
            ? {persistedCheckoutCredential: ambientGitConfig.persistedCheckoutCredential}
            : {}),
        }
      : {}),
  };
}

function credentialHelperOptions(credentialHelper: GitCredentialHelperConfig | undefined): {
  credentialHelper?: GitCredentialHelperConfig;
} {
  return credentialHelper === undefined ? {} : {credentialHelper};
}

function authOptions(params: {
  auth: CheckoutTokenResponseDto['auth'];
  shouldPersistCredential: boolean;
  persistedCheckoutCredential: PersistedCheckoutCredential | undefined;
}): {auth?: CheckoutTokenResponseDto['auth']} {
  if (params.persistedCheckoutCredential !== undefined || !params.shouldPersistCredential) {
    return {};
  }
  if (params.auth === undefined) return {};
  return {auth: params.auth};
}

function persistedCheckoutCredentialFromCheckout(params: {
  checkout: CheckoutTokenResponseDto;
  checkoutStepId: string;
  checkoutAttempt: number;
}): PersistedCheckoutCredential | undefined {
  const auth = params.checkout.auth;
  if (auth?.kind !== 'basic' || auth.generation === undefined || auth.renewal === undefined) {
    return undefined;
  }

  return {
    repositoryUrl: params.checkout.repository_url,
    checkoutStepId: params.checkoutStepId,
    checkoutAttempt: params.checkoutAttempt,
    credential: {
      username: auth.username,
      token: auth.token,
      expiresAt: auth.expires_at,
      generation: auth.generation,
      renewal:
        auth.renewal.mode === 'refresh-at'
          ? {mode: 'refresh-at', refreshAt: auth.renewal.refresh_at}
          : {mode: 'on-rejection'},
    },
  };
}

const CHECKOUT_KIND_REASON: Record<CheckoutFailureKind, StepErrorReasonDto> = {
  auth: 'checkout_auth_failed',
  unavailable: 'checkout_unavailable',
  failed: 'checkout_failed',
  aborted: 'setup_aborted',
};

function fail(error: unknown, reason: StepErrorReasonDto): StepResult {
  return {
    success: false,
    error: {message: messageOf(error), reason},
    exit_code: null,
  };
}

function writeCheckoutCommand(
  log: CheckoutLogSink | undefined,
  metadata: CheckoutCommandStartMetadata,
): void {
  log?.writeGroup({
    name: checkoutPhaseTitle(metadata.phase),
    lines: [`Command: ${metadata.command}`, `Working directory: ${metadata.cwd}`],
  });
}

function checkoutOutput(log: CheckoutLogSink | undefined): CheckoutOutputSink | undefined {
  if (!log) return undefined;
  return (chunk, source) => log.write(chunk, source);
}

function credentialLines(auth: CheckoutTokenResponseDto['auth']): string[] {
  if (!auth) return ['No repository credential was required.'];
  return [
    auth.kind === 'bearer'
      ? 'Using a short-lived repository token.'
      : 'Using a short-lived username/password repository credential.',
    auth.expires_at ? `Expires at: ${auth.expires_at}` : 'No expiration was provided.',
  ];
}

function checkoutPhaseTitle(phase: CheckoutPhase): string {
  switch (phase) {
    case 'init':
      return 'Initialize repository';
    case 'remote':
      return 'Add repository remote';
    case 'fetch':
      return 'Fetch requested ref';
    case 'checkout':
      return 'Check out commit';
    case 'resolve':
      return 'Read checked-out commit';
  }
}

function checkoutPhaseAction(phase: CheckoutPhase): string {
  switch (phase) {
    case 'init':
      return 'initializing the local Git repository';
    case 'remote':
      return 'adding the repository remote';
    case 'fetch':
      return 'fetching the requested ref';
    case 'checkout':
      return 'checking out the fetched commit';
    case 'resolve':
      return 'reading the checked-out commit';
  }
}

function checkoutTokenFailureHelp(reason: StepErrorReasonDto): string {
  if (reason === 'checkout_auth_failed') {
    return 'Check that the runner is connected to this workspace and the job is allowed to read this repository.';
  }
  if (reason === 'checkout_unavailable') {
    return 'Retry the job; Shipfox or the repository provider may be temporarily unavailable.';
  }
  return 'Check the repository connection and job permissions in Shipfox, then retry the job.';
}

function checkoutFailureResult(params: {
  error: unknown;
  log: CheckoutLogSink | undefined;
  scope: CheckoutFailureScope;
}): {ok: false; result: StepResult} {
  const reason =
    params.error instanceof CheckoutError
      ? CHECKOUT_KIND_REASON[params.error.kind]
      : 'checkout_failed';
  const repositoryVisibilityFailure =
    params.error instanceof CheckoutError && params.error.repositoryVisibilityFailure;
  writeFailure(
    params.log,
    checkoutFailureSummary(params.scope, params.error),
    checkoutFailureHelp(
      reason,
      repositoryVisibilityFailure,
      params.error instanceof CheckoutError && params.error.retryExhausted,
    ),
    params.error,
  );
  return {ok: false, result: fail(params.error, reason)};
}

function checkoutFailureSummary(scope: CheckoutFailureScope, error: unknown): string {
  const subject = scope === 'setup' ? 'Setup' : 'Checkout step';
  if (error instanceof CheckoutError && error.retryExhausted && error.kind === 'auth') {
    return `${subject} failed because GitHub still did not expose this repository after retrying.`;
  }
  if (error instanceof CheckoutError && error.repositoryVisibilityFailure) {
    return `${subject} failed because GitHub did not expose this repository to the checkout credential.`;
  }
  if (error instanceof CheckoutError && error.phase) {
    return `${subject} failed while ${checkoutPhaseAction(error.phase)}.`;
  }
  return `${subject} failed while checking out the repository.`;
}

function checkoutFailureHelp(
  reason: StepErrorReasonDto,
  repositoryVisibilityFailure = false,
  retryExhausted = false,
): string {
  if (retryExhausted && reason === 'checkout_auth_failed') {
    return 'Retry the job. If this repeats, reconnect GitHub or confirm the GitHub App can read the repository.';
  }
  if (repositoryVisibilityFailure) {
    return 'Retry the job. If this repeats, reconnect GitHub or confirm the GitHub App can read the repository.';
  }
  if (reason === 'checkout_auth_failed') {
    return 'Check the repository connection in Shipfox and confirm it has permission to read this repository.';
  }
  if (reason === 'checkout_unavailable') {
    return 'Check the runner network and DNS access to the Git provider, then retry the job.';
  }
  if (reason === 'setup_aborted') {
    return 'The job was cancelled or timed out before checkout completed.';
  }
  return 'Check that the repository URL and requested ref are valid. The git output above may include provider details.';
}

function writeCheckoutRetryLog(log: CheckoutLogSink | undefined, event: CheckoutRetryEvent): void {
  if (event === 'retrying') {
    log?.writeOutputLine(
      'GitHub did not expose this repository to the checkout credential. Shipfox will retry once.',
      'stderr',
    );
  } else if (event === 'recovered') {
    log?.writeOutputLine(
      'Checkout recovered after a transient GitHub authorization failure.',
      'stderr',
    );
  } else if (event === 'exhausted') {
    log?.writeOutputLine('Checkout retry exhausted after the second fetch failed.', 'stderr');
  }
}

function writeFailure(
  log: CheckoutLogSink | undefined,
  summary: string,
  nextStep: string,
  error: unknown,
): void {
  log?.writeOutputLine(`${summary} Details: ${messageOf(error)}`, 'stderr');
  log?.writeOutputLine(`Next step: ${nextStep}`, 'stderr');
}

function writeWarning(
  log: CheckoutLogSink | undefined,
  name: string,
  lines: readonly string[],
  scope: CheckoutFailureScope,
): void {
  if (log) {
    log.writeGroup({name, lines, source: 'stderr'});
    return;
  }
  logger().warn({name, lines}, scope === 'setup' ? 'Setup warning' : 'Checkout warning');
}

export function safeRepositoryUrl(repositoryUrl: string): string {
  return repositoryUrl.replace(URL_CREDENTIAL_RE, '$1***@');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
