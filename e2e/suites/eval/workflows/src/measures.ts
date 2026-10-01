import type {RunUsageResponseDto} from '@shipfox/api-usage-dto';
import type {WorkflowRunObservation} from '@shipfox/e2e-observe-workflows';

/** What a live run cost to produce, read from the usage route and the run observation. */
export interface RunMeasures {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  reasoning_tokens: number;
  model_requests: number;
  /** Step attempts beyond the first, which a failing gate caused. */
  gate_retries: number;
}

/** Every step attempt after a step's first one is a gate retry. */
export function countGateRetries(observation: WorkflowRunObservation): number {
  return observation.jobs
    .flatMap((job) => job.executions)
    .flatMap((execution) => execution.steps)
    .reduce((total, step) => total + Math.max(0, step.attempts.length - 1), 0);
}

export function tokenMeasures(usage: RunUsageResponseDto) {
  const totals = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    reasoning_tokens: 0,
    model_requests: 0,
  };
  for (const segment of usage.inference_segments) {
    totals.input_tokens += segment.input_tokens;
    totals.output_tokens += segment.output_tokens;
    totals.cache_read_tokens += segment.cache_read_tokens;
    totals.reasoning_tokens += segment.reasoning_tokens;
    totals.model_requests += segment.request_count;
  }
  return totals;
}

export async function collectMeasures({
  client,
  workspaceId,
  runId,
  observation,
}: {
  client: {requestJson<T>(method: 'get', path: string): Promise<T>};
  workspaceId: string;
  runId: string;
  observation: WorkflowRunObservation;
}): Promise<RunMeasures> {
  const usage = await client.requestJson<RunUsageResponseDto>(
    'get',
    `/usage/workspaces/${workspaceId}/runs/${runId}`,
  );
  return {...tokenMeasures(usage), gate_retries: countGateRetries(observation)};
}
