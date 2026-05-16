import {
  type CompleteJobBodyDto,
  type CompleteJobResponseDto,
  completeJobResponseSchema,
  type HeartbeatResponseDto,
  heartbeatResponseSchema,
  type JobPayloadResponseDto,
  jobPayloadResponseSchema,
} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import ky, {HTTPError} from 'ky';
import {config} from '#config.js';

const api = ky.create({
  baseUrl: config.SHIPFOX_API_URL,
  headers: {
    Authorization: `Bearer ${config.SHIPFOX_RUNNER_TOKEN}`,
  },
});

export async function requestJob(): Promise<JobPayloadResponseDto | null> {
  logger().debug('Polling for job');

  const response = await api.post('runners/jobs/request');

  if (response.status === 204) {
    return null;
  }

  return jobPayloadResponseSchema.parse(await response.json());
}

export async function completeJob(
  params: CompleteJobBodyDto & {jobId: string},
): Promise<CompleteJobResponseDto> {
  logger().info({jobId: params.jobId, status: params.status}, 'Reporting job completion');

  const response = await api.post(`runners/jobs/${params.jobId}/complete`, {
    json: {
      status: params.status,
      steps: params.steps,
    } satisfies CompleteJobBodyDto,
  });
  return completeJobResponseSchema.parse(await response.json());
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
