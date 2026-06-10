import {
  type ClaimedJobResponseDto,
  claimedJobResponseSchema,
  type HeartbeatResponseDto,
  heartbeatResponseSchema,
} from '@shipfox/api-runners-dto';
import {
  type NextStepResponseDto,
  nextStepResponseSchema,
  type ReportStepBodyDto,
  type ReportStepResponseDto,
  reportStepResponseSchema,
} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import ky, {HTTPError} from 'ky';
import {config} from '#config.js';

const api = ky.create({
  baseUrl: config.SHIPFOX_API_URL.endsWith('/')
    ? config.SHIPFOX_API_URL
    : `${config.SHIPFOX_API_URL}/`,
  headers: {
    Authorization: `Bearer ${config.SHIPFOX_RUNNER_TOKEN}`,
  },
});

// Claim the next job with the long-lived runner token. The response carries a
// short-lived, job-scoped lease token the runner then uses to pull/report steps.
export async function requestJob(): Promise<ClaimedJobResponseDto | null> {
  logger().debug('Polling for job');

  const response = await api.post('runners/jobs/request');

  if (response.status === 204) {
    return null;
  }

  return claimedJobResponseSchema.parse(await response.json());
}

// Pull the next step to run on the leased job. The job is named by the lease
// token, so a retried pull returns the same in-flight step (idempotent).
export async function nextStep(leaseToken: string): Promise<NextStepResponseDto> {
  const response = await api.post('runs/jobs/current/steps/next', {
    headers: {Authorization: `Bearer ${leaseToken}`},
  });
  return nextStepResponseSchema.parse(await response.json());
}

// Report a step result on the leased job. Reporting the same step again is safe.
export async function reportStep(
  leaseToken: string,
  stepId: string,
  body: ReportStepBodyDto,
): Promise<ReportStepResponseDto> {
  const response = await api.post(`runs/jobs/current/steps/${stepId}/report`, {
    headers: {Authorization: `Bearer ${leaseToken}`},
    json: body,
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
