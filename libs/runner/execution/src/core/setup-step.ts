import type {CheckoutTokenResponseDto, StepErrorReason} from '@shipfox/api-workflows-dto';
import {HTTPError, requestCheckoutToken} from '@shipfox/runner-protocol';
import {
  assertGitAvailable,
  CheckoutError,
  type CheckoutFailureKind,
  checkoutRepository,
  createJobDir,
} from '@shipfox/runner-workspace';
import type {KyInstance} from 'ky';
import type {StepResult} from '#core/step-result.js';

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
}): Promise<StepResult> {
  const {cwd, leaseClient, signal} = params;

  // Check git before minting a credential: a host without git never hits the provider.
  try {
    await assertGitAvailable();
  } catch (error) {
    return fail(error, 'git_unavailable');
  }

  try {
    await createJobDir(cwd);
  } catch (error) {
    return fail(error, 'workspace_prep_failed');
  }

  let checkout: CheckoutTokenResponseDto;
  try {
    checkout = await requestCheckoutToken(leaseClient, {signal});
  } catch (error) {
    return fail(error, classifyCheckoutTokenError(error));
  }

  try {
    await checkoutRepository({
      repositoryUrl: checkout.repository_url,
      ref: checkout.ref,
      auth: checkout.auth,
      cwd,
      signal,
    });
  } catch (error) {
    const reason =
      error instanceof CheckoutError ? CHECKOUT_KIND_REASON[error.kind] : 'checkout_failed';
    return fail(error, reason);
  }

  return {success: true, output: '', error: null, exit_code: 0};
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
    output: '',
    error: {message: error instanceof Error ? error.message : String(error), reason},
    exit_code: null,
  };
}
