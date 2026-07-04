import {setTimeout as delay} from 'node:timers/promises';
import type {DefinitionListResponseDto} from '@shipfox/api-definitions-dto';
import type {
  WorkflowRunDetailResponseDto,
  WorkflowRunListResponseDto,
} from '@shipfox/api-workflows-dto';
import {type ApiFetch, createApiClient} from '@shipfox/e2e-core';

export interface PollingOptions {
  fetch?: ApiFetch | undefined;
  projectId: string;
  signal?: AbortSignal | undefined;
  timeoutMs: number;
  token: string;
}

export async function waitForDefinitionSyncTerminal(
  options: PollingOptions,
): Promise<DefinitionListResponseDto> {
  const client = createApiClient({fetch: options.fetch, token: options.token});
  const deadline = Date.now() + options.timeoutMs;
  let lastResponse: DefinitionListResponseDto | null = null;

  while (Date.now() <= deadline) {
    options.signal?.throwIfAborted();
    const params = new URLSearchParams({project_id: options.projectId, limit: '100'});
    lastResponse = await client.requestJson<DefinitionListResponseDto>(
      'get',
      `/definitions?${params}`,
      {signal: options.signal},
    );

    const status = lastResponse.sync?.status;
    if (status === 'failed' || status === 'succeeded') return lastResponse;

    await delay(250, undefined, {signal: options.signal});
  }

  const status = lastResponse?.sync?.status ?? 'null';
  throw new Error(`Timed out waiting for definition sync to settle: syncStatus=${status}`);
}

export async function waitForNoWorkflowRuns(
  options: PollingOptions,
): Promise<WorkflowRunListResponseDto> {
  const client = createApiClient({fetch: options.fetch, token: options.token});
  const deadline = Date.now() + options.timeoutMs;
  let lastResponse: WorkflowRunListResponseDto | null = null;

  while (Date.now() <= deadline) {
    options.signal?.throwIfAborted();
    const params = new URLSearchParams({project_id: options.projectId, limit: '100'});
    lastResponse = await client.requestJson<WorkflowRunListResponseDto>(
      'get',
      `/workflows/runs?${params}`,
      {signal: options.signal},
    );
    if (lastResponse.runs.length > 0) return lastResponse;

    await delay(250, undefined, {signal: options.signal});
  }

  return lastResponse ?? {runs: [], next_cursor: null, filtered_total_count: null};
}

export async function waitForRunDetailMatching(params: {
  token: string;
  runId: string;
  timeoutMs: number;
  description: string;
  matches: (runDetail: WorkflowRunDetailResponseDto) => {matched: boolean; diagnostic: string};
}): Promise<WorkflowRunDetailResponseDto> {
  const client = createApiClient({token: params.token});
  const deadline = Date.now() + params.timeoutMs;
  let lastResponse: WorkflowRunDetailResponseDto | null = null;
  let lastDiagnostic = 'no workflow run detail response observed';

  while (Date.now() <= deadline) {
    lastResponse = await client.requestJson<WorkflowRunDetailResponseDto>(
      'get',
      `/workflows/runs/${encodeURIComponent(params.runId)}`,
    );
    const result = params.matches(lastResponse);
    if (result.matched) return lastResponse;
    lastDiagnostic = result.diagnostic;
    await delay(250);
  }

  throw new Error(`Timed out waiting for ${params.description}: ${lastDiagnostic}`);
}
