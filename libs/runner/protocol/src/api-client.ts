import {
  type AgentRuntimeCredentialsResponseDto,
  agentRuntimeCredentialsResponseSchema,
} from '@shipfox/api-agent-dto';
import {appendLogsResponseSchema, offsetGapResponseSchema} from '@shipfox/api-logs-dto';
import {
  type ClaimedJobResponseDto,
  claimedJobResponseSchema,
  type HeartbeatResponseDto,
  heartbeatResponseSchema,
  type RegisterRunnerResponseDto,
  RUNNER_SESSION_EXHAUSTED_CODE,
  registerRunnerBodySchema,
  registerRunnerResponseSchema,
} from '@shipfox/api-runners-dto';
import {
  type AgentConfigIssue,
  type CheckoutTokenResponseDto,
  checkoutTokenResponseSchema,
  type LogOutcomeDto,
  type NextStepResponseDto,
  nextStepResponseSchema,
  type ReportStepResponseDto,
  reportStepBodySchema,
  reportStepResponseSchema,
  type StepErrorDtoShape,
} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {isUuid} from '@shipfox/regex';
import {canonicalizeLabels} from '@shipfox/runner-labels';
import ky, {HTTPError, type KyInstance} from 'ky';
import {config} from '#config.js';

/** Media type the append endpoint expects for the raw NDJSON request body. */
const LOG_NDJSON_CONTENT_TYPE = 'application/x-ndjson';

/**
 * The runner-facing result of one append, after the transport has interpreted the
 * HTTP status. `committed` carries the new server offset (and whether the budget is
 * now exhausted); `conflict` carries the offset to rewind/fast-forward to; `stopped`
 * means the endpoint is gone or the lease is no longer accepted, so the uploader gives
 * up (the server's stream lifecycle takes over).
 */
export type LogAppendOutcome =
  | {status: 'committed'; committedLength: number; capped: boolean}
  | {status: 'conflict'; committedLength: number}
  | {status: 'stopped'};

/**
 * The append port the runner's uploader depends on. The caller binds the lease
 * client, step, and attempt; the uploader only supplies the offset and body.
 */
export type LogAppendFn = (args: {
  offset: number;
  body: Uint8Array;
  signal?: AbortSignal;
}) => Promise<LogAppendOutcome>;

const baseUrl = config.SHIPFOX_API_URL.endsWith('/')
  ? config.SHIPFOX_API_URL
  : `${config.SHIPFOX_API_URL}/`;

const registrationApi = ky.create({
  baseUrl,
  headers: {
    Authorization: `Bearer ${config.SHIPFOX_RUNNER_TOKEN}`,
  },
});

/**
 * The runner's long-lived bearer credential, exposed so the log masker can scrub it from
 * captured step output: a step that echoes its environment must never leak it to the
 * plaintext spool. For masking only — never log this value.
 */
export function runnerToken(): string {
  return config.SHIPFOX_RUNNER_TOKEN;
}

export function configuredRunnerLabels(): string[] {
  return [...canonicalizeLabels(config.SHIPFOX_RUNNER_LABELS.split(','))];
}

export class RunnerLabelsRequiredError extends Error {
  constructor() {
    super('SHIPFOX_RUNNER_LABELS must contain at least one non-empty label.');
    this.name = 'RunnerLabelsRequiredError';
  }
}

export class RunnerSessionExhaustedError extends Error {
  constructor() {
    super('Runner session is exhausted.');
    this.name = 'RunnerSessionExhaustedError';
  }
}

export class AgentRuntimeConfigRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    public readonly agentConfigIssue: AgentConfigIssue | undefined = agentConfigIssueForCode(code),
  ) {
    super(
      code === undefined
        ? `Agent runtime config request failed with status ${status}.`
        : `Agent runtime config request failed with status ${status}: ${code}.`,
    );
    this.name = 'AgentRuntimeConfigRequestError';
  }
}

export function requireRunnerLabels(): string[] {
  const labels = configuredRunnerLabels();
  if (labels.length === 0) throw new RunnerLabelsRequiredError();
  return labels;
}

export async function registerRunnerSession(): Promise<RegisterRunnerResponseDto> {
  const labels = configuredRunnerLabels();

  logger().debug({labels}, 'Registering runner session');

  const body = registerRunnerBodySchema.parse({labels});
  const response = await registrationApi.post('runners/register', {json: body});

  return registerRunnerResponseSchema.parse(await response.json());
}

function createRunnerSessionClient(sessionToken: string): KyInstance {
  return ky.create({
    baseUrl,
    headers: {
      Authorization: `Bearer ${sessionToken}`,
    },
  });
}

// Scheduling is step-less: the claim returns only the job/run ids and the lease
// token. Steps are pulled one at a time from the step API using that token.
export async function requestJob(sessionToken: string): Promise<ClaimedJobResponseDto | null> {
  logger().debug('Polling for job');

  const response = await postJobRequest(sessionToken);

  if (response.status === 204) {
    return null;
  }

  return claimedJobResponseSchema.parse(await response.json());
}

async function postJobRequest(sessionToken: string): Promise<Response> {
  try {
    return await createRunnerSessionClient(sessionToken).post('runners/jobs/request');
  } catch (error) {
    if (!(error instanceof HTTPError) || error.response.status !== 409) throw error;

    if (hasRunnerSessionExhaustedCode(error.data)) {
      throw new RunnerSessionExhaustedError();
    }

    throw error;
  }
}

function hasRunnerSessionExhaustedCode(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    'code' in body &&
    body.code === RUNNER_SESSION_EXHAUSTED_CODE
  );
}

// next/report are idempotent, so we widen ky's retry to POST (off by default): a lost
// response is retried in place, never re-pulling or re-executing a step. A 404 is not
// retried — it surfaces so the loop can stop.
export type LeaseTokenSource = string | (() => string);

function readLeaseToken(leaseToken: LeaseTokenSource): string {
  return typeof leaseToken === 'function' ? leaseToken() : leaseToken;
}

export function createLeaseClient(leaseToken: LeaseTokenSource): KyInstance {
  return ky.create({
    baseUrl,
    hooks: {
      beforeRequest: [
        ({request}) => {
          request.headers.set('Authorization', `Bearer ${readLeaseToken(leaseToken)}`);
        },
      ],
    },
    retry: {
      methods: ['post'],
      statusCodes: [408, 429, 500, 502, 503, 504],
    },
  });
}

export async function requestNextStep(
  leaseClient: KyInstance,
  options: {signal?: AbortSignal} = {},
): Promise<NextStepResponseDto> {
  const response = await leaseClient.post(
    'runs/jobs/current/steps/next',
    options.signal ? {signal: options.signal} : undefined,
  );
  return nextStepResponseSchema.parse(await response.json());
}

export async function reportStep(
  leaseClient: KyInstance,
  params: {
    stepId: string;
    attempt: number;
    status: 'succeeded' | 'failed';
    error?: StepErrorDtoShape;
    exitCode: number | null;
    logOutcome: LogOutcomeDto;
    signal?: AbortSignal;
  },
): Promise<ReportStepResponseDto> {
  const body = reportStepBodySchema.parse({
    status: params.status,
    error: params.error ?? undefined,
    attempt: params.attempt,
    exit_code: params.exitCode,
    log_outcome: params.logOutcome,
  });

  const response = await leaseClient.post(`runs/jobs/current/steps/${params.stepId}/report`, {
    json: body,
    ...(params.signal ? {signal: params.signal} : {}),
  });
  return reportStepResponseSchema.parse(await response.json());
}

// Exchanges the job lease for short-lived, read-only checkout credentials. The job is
// identified by the lease claims, so no id is sent. Retries ride the leaseClient policy
// (which honors Retry-After); each retry re-mints a fresh short-lived credential.
export async function requestCheckoutToken(
  leaseClient: KyInstance,
  options: {signal?: AbortSignal} = {},
): Promise<CheckoutTokenResponseDto> {
  const response = await leaseClient.post(
    'runs/jobs/current/checkout-token',
    options.signal ? {signal: options.signal} : undefined,
  );
  return checkoutTokenResponseSchema.parse(await response.json());
}

export async function requestAgentRuntimeConfig(
  leaseClient: KyInstance,
  params: {
    stepId: string;
    attempt: number;
    signal?: AbortSignal;
  },
): Promise<AgentRuntimeCredentialsResponseDto> {
  let response: Response;
  try {
    response = await leaseClient.get('runs/jobs/current/agent-runtime-config', {
      searchParams: {step_id: params.stepId, attempt: params.attempt},
      retry: {
        methods: ['get'],
        statusCodes: [429, 500, 502, 503, 504],
      },
      ...(params.signal ? {signal: params.signal} : {}),
    });
  } catch (error) {
    if (error instanceof HTTPError) {
      throw new AgentRuntimeConfigRequestError(error.response.status, codeFromBody(error.data));
    }
    throw error;
  }

  if (response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new AgentRuntimeConfigRequestError(200, 'agent-runtime-config-invalid');
    }

    const parsed = agentRuntimeCredentialsResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new AgentRuntimeConfigRequestError(200, 'agent-runtime-config-invalid');
    }
    return parsed.data;
  }

  throw new AgentRuntimeConfigRequestError(response.status, await errorCode(response));
}

// throwHttpErrors:false (below) turns off ky's status-code retry for this call, so no
// HTTP status is retried in-transport here (only network/timeout errors are). Every
// status is mapped explicitly: 409 and the terminal 4xx to outcomes, 5xx/unknown to a
// thrown error the uploader retries on its next tick.
export async function appendStepLogs(
  leaseClient: KyInstance,
  params: {
    stepId: string;
    attempt: number;
    offset: number;
    body: Uint8Array;
    signal?: AbortSignal;
  },
): Promise<LogAppendOutcome> {
  if (!isUuid(params.stepId)) {
    throw new Error(`Invalid step id for log append: ${params.stepId}`);
  }

  // throwHttpErrors:false so we can read the 409 body ourselves (ky discards it when
  // it builds an HTTPError). It also disables ky's status-code retry, so 5xx is not
  // retried in-transport and falls through to the throw below.
  const response = await leaseClient.post(`runs/jobs/current/steps/${params.stepId}/logs`, {
    body: params.body,
    headers: {'content-type': LOG_NDJSON_CONTENT_TYPE},
    searchParams: {attempt: params.attempt, offset: params.offset},
    throwHttpErrors: false,
    ...(params.signal ? {signal: params.signal} : {}),
  });

  if (response.ok) {
    const {committed_length, capped} = appendLogsResponseSchema.parse(await response.json());
    return {status: 'committed', committedLength: committed_length, capped};
  }
  if (response.status === 409) {
    const {details} = offsetGapResponseSchema.parse(await response.json());
    return {status: 'conflict', committedLength: details.committed_length};
  }
  // Any other 4xx is permanent for this request: the endpoint is gone (deploy skew), the
  // lease is rejected (401/403), or the body will never be accepted (400 malformed, 413 too
  // large, 415/422, ...). Re-sending the identical body cannot succeed, so stop and let the
  // server's stream lifecycle close the stream. 408/429 are transient and fall through to
  // the retry path so server-driven backpressure still paces (not storms) the next attempt.
  if (
    response.status >= 400 &&
    response.status < 500 &&
    response.status !== 408 &&
    response.status !== 429
  ) {
    return {status: 'stopped'};
  }
  // 5xx, 408, 429, or any other unexpected status: throw so the uploader logs it and retries
  // on the next tick (throwHttpErrors disables ky's in-transport status-code retry).
  throw new Error(`Log append failed with status ${response.status}`);
}

export async function heartbeat(
  jobId: string,
  leaseToken: string,
  options: {signal?: AbortSignal} = {},
): Promise<HeartbeatResponseDto> {
  const response = await createLeaseClient(leaseToken).post(
    `runners/jobs/${jobId}/heartbeat`,
    options.signal ? {signal: options.signal} : undefined,
  );
  return heartbeatResponseSchema.parse(await response.json());
}

export {HTTPError};

async function errorCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as unknown;
    return codeFromBody(body);
  } catch {
    return undefined;
  }
}

function codeFromBody(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('code' in body)) return undefined;
  return typeof body.code === 'string' ? body.code : undefined;
}

function agentConfigIssueForCode(code: string | undefined): AgentConfigIssue | undefined {
  switch (code) {
    case 'agent-config-invalid':
    case 'agent-step-config-invalid':
    case 'agent-runtime-config-invalid':
      return 'step_config_invalid';
    case 'agent-provider-not-configured':
      return 'provider_not_configured';
    case 'agent-provider-unsupported':
      return 'provider_unsupported';
    case 'agent-model-unavailable':
      return 'model_unavailable';
    case 'agent-provider-credentials-invalid':
      return 'credentials_invalid';
    default:
      return undefined;
  }
}
