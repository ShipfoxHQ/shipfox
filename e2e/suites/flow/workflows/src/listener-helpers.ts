import type {WebhookConnectionDto} from '@shipfox/api-integration-webhook-dto';
import type {
  JobStatusDto,
  ListenerStatusDto,
  ResolutionReasonDto,
  WorkflowRunDetailResponseDto,
  WorkflowRunJobDetailDto,
  WorkflowRunJobExecutionDetailDto,
} from '@shipfox/api-workflows-dto';
import type {createApiClient} from '@shipfox/e2e-core';
import {waitForRunDetailMatching} from './polling.js';
import {postWebhookDelivery} from './webhook.js';

export interface ListenerPredicateResult {
  matched: boolean;
  diagnostic: string;
}

export function findListenerJob(
  runDetail: WorkflowRunDetailResponseDto,
  jobKey: string,
): WorkflowRunJobDetailDto | undefined {
  return runDetail.jobs.find((job) => job.key === jobKey && job.mode === 'listening');
}

export function listenerExecutionCountMatches(params: {
  runDetail: WorkflowRunDetailResponseDto;
  jobKey: string;
  count: number;
}): ListenerPredicateResult {
  const job = findListenerJob(params.runDetail, params.jobKey);
  if (!job) {
    return {
      matched: false,
      diagnostic: `listener job ${params.jobKey} missing`,
    };
  }
  const actual = job.job_executions.length;
  return {
    matched: actual === params.count,
    diagnostic: `listener job ${params.jobKey} executionCount=${actual}, expected=${params.count}`,
  };
}

export function listenerStatusMatches(params: {
  runDetail: WorkflowRunDetailResponseDto;
  jobKey: string;
  listenerStatus: ListenerStatusDto;
}): ListenerPredicateResult {
  const job = findListenerJob(params.runDetail, params.jobKey);
  if (!job) return {matched: false, diagnostic: `listener job ${params.jobKey} missing`};
  return {
    matched: job.listener_status === params.listenerStatus,
    diagnostic: `listener job ${params.jobKey} listenerStatus=${job.listener_status}, expected=${params.listenerStatus}`,
  };
}

export function listenerResolutionMatches(params: {
  runDetail: WorkflowRunDetailResponseDto;
  jobKey: string;
  status: JobStatusDto;
  reason: ResolutionReasonDto;
}): ListenerPredicateResult {
  const job = findListenerJob(params.runDetail, params.jobKey);
  if (!job) return {matched: false, diagnostic: `listener job ${params.jobKey} missing`};
  const statusMatches = job.status === params.status;
  const listenerStatusMatches = job.listener_status === 'resolved';
  const reasonMatches = job.resolution_reason === params.reason;
  return {
    matched: statusMatches && listenerStatusMatches && reasonMatches,
    diagnostic: `listener job ${params.jobKey} status=${job.status}, listenerStatus=${job.listener_status}, resolutionReason=${job.resolution_reason}, expected=${params.status}/resolved/${params.reason}`,
  };
}

export function listenerExecutionStatusMatches(params: {
  runDetail: WorkflowRunDetailResponseDto;
  jobKey: string;
  sequence: number;
  status: WorkflowRunJobExecutionDetailDto['status'];
}): ListenerPredicateResult {
  const execution = findListenerExecutionBySequence(params);
  if (!execution) {
    return {
      matched: false,
      diagnostic: `listener job ${params.jobKey} execution ${params.sequence} missing`,
    };
  }
  return {
    matched: execution.status === params.status,
    diagnostic: `listener job ${params.jobKey} execution ${params.sequence} status=${execution.status}, expected=${params.status}`,
  };
}

export function listenerDeliveryObserved(params: {
  runDetail: WorkflowRunDetailResponseDto;
  jobKey: string;
  deliveryId: string;
}): ListenerPredicateResult {
  const execution = findListenerExecutionByDeliveryId(params);
  if (execution) {
    return {
      matched: true,
      diagnostic: `listener job ${params.jobKey} observed delivery ${params.deliveryId} in execution ${execution.sequence}`,
    };
  }
  const job = findListenerJob(params.runDetail, params.jobKey);
  if (!job) return {matched: false, diagnostic: `listener job ${params.jobKey} missing`};
  const observed = job.job_executions.flatMap((candidate) =>
    candidate.trigger_events.map((event) => event.delivery_id),
  );
  return {
    matched: false,
    diagnostic: `listener job ${params.jobKey} did not observe delivery ${params.deliveryId}; observed=[${observed.join(', ')}]`,
  };
}

export function batchedListenerExecutionMatches(params: {
  runDetail: WorkflowRunDetailResponseDto;
  jobKey: string;
  sequence: number;
  deliveryIds: string[];
}): ListenerPredicateResult {
  const execution = findListenerExecutionBySequence(params);
  if (!execution) {
    return {
      matched: false,
      diagnostic: `listener job ${params.jobKey} execution ${params.sequence} missing`,
    };
  }
  const observed = new Set(execution.trigger_events.map((event) => event.delivery_id));
  const missing = params.deliveryIds.filter((deliveryId) => !observed.has(deliveryId));
  return {
    matched: missing.length === 0 && execution.trigger_events.length === params.deliveryIds.length,
    diagnostic: `listener job ${params.jobKey} execution ${params.sequence} observed=[${[
      ...observed,
    ].join(', ')}], expected=[${params.deliveryIds.join(', ')}]`,
  };
}

export function findListenerExecutionByDeliveryId(params: {
  runDetail: WorkflowRunDetailResponseDto;
  jobKey: string;
  deliveryId: string;
}): WorkflowRunJobExecutionDetailDto | undefined {
  const job = findListenerJob(params.runDetail, params.jobKey);
  return job?.job_executions.find((execution) =>
    execution.trigger_events.some((event) => event.delivery_id === params.deliveryId),
  );
}

export function findListenerExecutionByDeliveryIds(params: {
  runDetail: WorkflowRunDetailResponseDto;
  jobKey: string;
  deliveryIds: string[];
}): {deliveryId: string; execution: WorkflowRunJobExecutionDetailDto} | undefined {
  const expected = new Set(params.deliveryIds);
  const job = findListenerJob(params.runDetail, params.jobKey);
  for (const execution of job?.job_executions ?? []) {
    const event = execution.trigger_events.find((candidate) => expected.has(candidate.delivery_id));
    if (event) return {deliveryId: event.delivery_id, execution};
  }
  return undefined;
}

export function findListenerExecutionBySequence(params: {
  runDetail: WorkflowRunDetailResponseDto;
  jobKey: string;
  sequence: number;
}): WorkflowRunJobExecutionDetailDto | undefined {
  return findListenerJob(params.runDetail, params.jobKey)?.job_executions.find(
    (execution) => execution.sequence === params.sequence,
  );
}

export async function waitForListenerExecution(params: {
  token: string;
  runId: string;
  jobKey: string;
  sequence: number;
  status?: WorkflowRunJobExecutionDetailDto['status'] | undefined;
  timeoutMs: number;
}): Promise<WorkflowRunDetailResponseDto> {
  return await waitForRunDetailMatching({
    token: params.token,
    runId: params.runId,
    timeoutMs: params.timeoutMs,
    description: `listener job ${params.jobKey} execution ${params.sequence}`,
    matches: (runDetail) => {
      if (params.status !== undefined) {
        return listenerExecutionStatusMatches({
          runDetail,
          jobKey: params.jobKey,
          sequence: params.sequence,
          status: params.status,
        });
      }
      return {
        matched:
          findListenerExecutionBySequence({
            runDetail,
            jobKey: params.jobKey,
            sequence: params.sequence,
          }) !== undefined,
        diagnostic: `listener job ${params.jobKey} execution ${params.sequence} missing`,
      };
    },
  });
}

export async function waitForListenerResolution(params: {
  token: string;
  runId: string;
  jobKey: string;
  status: JobStatusDto;
  reason: ResolutionReasonDto;
  timeoutMs: number;
}): Promise<WorkflowRunDetailResponseDto> {
  return await waitForRunDetailMatching({
    token: params.token,
    runId: params.runId,
    timeoutMs: params.timeoutMs,
    description: `listener job ${params.jobKey} resolution ${params.reason}`,
    matches: (runDetail) => listenerResolutionMatches({...params, runDetail}),
  });
}

export async function sendWebhookDeliveryUntilObserved(params: {
  client: ReturnType<typeof createApiClient>;
  connection: WebhookConnectionDto;
  runId: string;
  token: string;
  jobKey: string;
  deliveryIdPrefix: string;
  maxAttempts?: number | undefined;
  attemptTimeoutMs?: number | undefined;
  body: (attempt: number, deliveryId: string) => unknown;
}): Promise<{deliveryId: string; deliveryIds: string[]; runDetail: WorkflowRunDetailResponseDto}> {
  const maxAttempts = params.maxAttempts ?? 8;
  const attemptTimeoutMs = params.attemptTimeoutMs ?? 5_000;
  const deliveryIds: string[] = [];
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const deliveryId = `${params.deliveryIdPrefix}-${attempt}`;
    deliveryIds.push(deliveryId);
    await postWebhookDelivery({
      client: params.client,
      connection: params.connection,
      deliveryId,
      webhook: {body: params.body(attempt, deliveryId)},
    });

    try {
      const runDetail = await waitForRunDetailMatching({
        token: params.token,
        runId: params.runId,
        timeoutMs: attemptTimeoutMs,
        description: `listener delivery ${deliveryId}`,
        matches: (candidate) => {
          const match = findListenerExecutionByDeliveryIds({
            runDetail: candidate,
            jobKey: params.jobKey,
            deliveryIds,
          });
          if (match) {
            return {
              matched: true,
              diagnostic: `listener job ${params.jobKey} observed delivery ${match.deliveryId} in execution ${match.execution.sequence}`,
            };
          }
          const observed = findListenerJob(candidate, params.jobKey)?.job_executions.flatMap(
            (execution) => execution.trigger_events.map((event) => event.delivery_id),
          );
          return {
            matched: false,
            diagnostic: `listener job ${params.jobKey} did not observe deliveries [${deliveryIds.join(', ')}]; observed=[${observed?.join(', ') ?? ''}]`,
          };
        },
      });
      const match = findListenerExecutionByDeliveryIds({
        runDetail,
        jobKey: params.jobKey,
        deliveryIds,
      });
      if (!match) throw new Error(`Observed listener delivery match disappeared for ${deliveryId}`);
      return {deliveryId: match.deliveryId, deliveryIds, runDetail};
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Listener delivery was not observed after ${maxAttempts} attempts`);
}
