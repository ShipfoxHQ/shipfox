import {
  type HeartbeatResponseDto,
  heartbeatResponseSchema,
  type JobPayloadResponseDto,
  jobPayloadResponseSchema,
} from '@shipfox/api-runners-dto';
import {
  type NextStepResponseDto,
  nextStepResponseSchema,
  type ReportStepResponseDto,
  reportStepBodySchema,
  reportStepResponseSchema,
  type StepErrorDtoShape,
} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import ky, {HTTPError, type KyInstance} from 'ky';
import {config} from '#config.js';

const baseUrl = config.SHIPFOX_API_URL.endsWith('/')
  ? config.SHIPFOX_API_URL
  : `${config.SHIPFOX_API_URL}/`;

// Runner token (long-lived) authes claim + heartbeat; step calls use a per-job lease token.
const api = ky.create({
  baseUrl,
  headers: {
    Authorization: `Bearer ${config.SHIPFOX_RUNNER_TOKEN}`,
  },
});

// The runner only needs the claim's lease token; its steps[] are ignored — steps are
// pulled one at a time from the step API, not run from this payload.
export async function requestJob(): Promise<JobPayloadResponseDto | null> {
  logger().debug('Polling for job');

  const response = await api.post('runners/jobs/request');

  if (response.status === 204) {
    return null;
  }

  return jobPayloadResponseSchema.parse(await response.json());
}

// next/report are idempotent, so we widen ky's retry to POST (off by default): a lost
// response is retried in place, never re-pulling or re-executing a step. A 404 is not
// retried — it surfaces so the loop can stop.
export function createLeaseClient(leaseToken: string): KyInstance {
  return ky.create({
    baseUrl,
    headers: {
      Authorization: `Bearer ${leaseToken}`,
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
    signal?: AbortSignal;
  },
): Promise<ReportStepResponseDto> {
  const body = reportStepBodySchema.parse({
    status: params.status,
    error: params.error ?? undefined,
    attempt: params.attempt,
    exit_code: params.exitCode,
  });

  const response = await leaseClient.post(`runs/jobs/current/steps/${params.stepId}/report`, {
    json: body,
    ...(params.signal ? {signal: params.signal} : {}),
  });
  return reportStepResponseSchema.parse(await response.json());
}

export async function heartbeat(
  jobId: string,
  options: {signal?: AbortSignal} = {},
): Promise<HeartbeatResponseDto> {
  const response = await api.post(
    `runners/jobs/${jobId}/heartbeat`,
    options.signal ? {signal: options.signal} : undefined,
  );
  return heartbeatResponseSchema.parse(await response.json());
}

export {HTTPError};
