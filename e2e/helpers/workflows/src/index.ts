import {setTimeout as sleep} from 'node:timers/promises';
import type {
  WorkflowRunDetailResponseDto,
  WorkflowRunDto,
  WorkflowRunListResponseDto,
  WorkflowRunStatusDto,
} from '@shipfox/api-workflows-dto';
import {type ApiFetch, createApiClient} from '@shipfox/e2e-core';

const DEFAULT_LIST_TIMEOUT_MS = 60_000;
const DEFAULT_TERMINAL_TIMEOUT_MS = 180_000;
const DEFAULT_INITIAL_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 4_000;
const DEFAULT_BACKOFF_FACTOR = 1.5;
const TERMINAL_STATUSES = new Set<WorkflowRunStatusDto>(['succeeded', 'failed', 'cancelled']);

interface PollingOptions {
  apiUrl?: string | undefined;
  backoffFactor?: number | undefined;
  fetch?: ApiFetch | undefined;
  initialDelayMs?: number | undefined;
  maxDelayMs?: number | undefined;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
  token: string;
}

export interface WaitForRunByCommitOptions extends PollingOptions {
  headCommitSha: string;
  projectId: string;
}

export interface WaitForRunByDeliveryIdOptions extends PollingOptions {
  deliveryId: string;
  projectId: string;
}

export interface WaitForRunTerminalOptions extends PollingOptions {
  runId: string;
}

function nextDelay(currentDelayMs: number, options: PollingOptions): number {
  const factor = options.backoffFactor ?? DEFAULT_BACKOFF_FACTOR;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  return Math.min(Math.ceil(currentDelayMs * factor), maxDelayMs);
}

async function waitForNextPoll(params: {
  delayMs: number;
  deadline: number;
  signal?: AbortSignal | undefined;
}): Promise<void> {
  const remainingMs = params.deadline - Date.now();
  if (remainingMs <= 0) return;
  await sleep(Math.min(params.delayMs, remainingMs), undefined, {signal: params.signal});
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function headCommitSha(run: WorkflowRunDto): string | null {
  const payload = run.trigger_payload;
  if (!isRecord(payload) || !isRecord(payload.data)) return null;
  const data = payload.data;
  // Real push payloads use `after`; `headCommitSha` covers normalized test payloads.
  if (typeof data.headCommitSha === 'string') return data.headCommitSha;
  if (typeof data.after === 'string') return data.after;
  if (isRecord(data.head_commit) && typeof data.head_commit.id === 'string') {
    return data.head_commit.id;
  }
  return null;
}

function deliveryId(run: WorkflowRunDto): string | null {
  const payload = run.trigger_payload;
  if (!isRecord(payload)) return null;
  return typeof payload.deliveryId === 'string' ? payload.deliveryId : null;
}

function formatRunListObserved(
  response: WorkflowRunListResponseDto | null,
  expected: string,
  runField: (run: WorkflowRunDto) => string,
): string {
  if (!response) return 'no workflow run list response observed';
  const runs = response.runs
    .slice(0, 5)
    .map((run) =>
      [
        `id=${run.id}`,
        `status=${run.status}`,
        `trigger=${run.trigger_source}/${run.trigger_event}`,
        runField(run),
        `updatedAt=${run.updated_at}`,
      ].join(' '),
    );
  const more = response.runs.length > runs.length ? ', ...' : '';
  return `${expected} runs=[${runs.join(', ')}${more}]`;
}

function formatRunDetailObserved(
  response: WorkflowRunDetailResponseDto | null,
  runId: string,
): string {
  if (!response) return 'no workflow run detail response observed';
  return [
    `runId=${runId}`,
    `status=${response.status}`,
    `currentAttempt=${response.current_attempt}`,
    `latestAttempt=${response.latest_attempt}`,
    `updatedAt=${response.updated_at}`,
  ].join(' ');
}

async function waitForRunMatching(
  options: PollingOptions & {
    expected: string;
    match: (run: WorkflowRunDto) => boolean;
    projectId: string;
    runField: (run: WorkflowRunDto) => string;
    timeoutMessage: string;
  },
): Promise<WorkflowRunDto> {
  const client = createApiClient({
    apiUrl: options.apiUrl,
    fetch: options.fetch,
    token: options.token,
  });
  const timeoutMs = options.timeoutMs ?? DEFAULT_LIST_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let delayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  let lastResponse: WorkflowRunListResponseDto | null = null;

  while (Date.now() <= deadline) {
    options.signal?.throwIfAborted();
    const params = new URLSearchParams({project_id: options.projectId, limit: '100'});
    lastResponse = await client.requestJson<WorkflowRunListResponseDto>(
      'get',
      `/workflows/runs?${params}`,
      {signal: options.signal},
    );

    const run = lastResponse.runs.find(options.match);
    if (run) return run;

    await waitForNextPoll({deadline, delayMs, signal: options.signal});
    delayMs = nextDelay(delayMs, options);
  }

  throw new Error(
    `${options.timeoutMessage}: ${formatRunListObserved(
      lastResponse,
      options.expected,
      options.runField,
    )}`,
  );
}

export async function waitForRunByCommit(
  options: WaitForRunByCommitOptions,
): Promise<WorkflowRunDto> {
  return await waitForRunMatching({
    ...options,
    expected: `expectedHeadCommitSha=${options.headCommitSha}`,
    match: (run) => headCommitSha(run) === options.headCommitSha,
    runField: (run) => `headCommitSha=${headCommitSha(run) ?? 'null'}`,
    timeoutMessage: 'Timed out waiting for workflow run by commit',
  });
}

export async function waitForRunByDeliveryId(
  options: WaitForRunByDeliveryIdOptions,
): Promise<WorkflowRunDto> {
  return await waitForRunMatching({
    ...options,
    expected: `expectedDeliveryId=${options.deliveryId}`,
    match: (run) => deliveryId(run) === options.deliveryId,
    runField: (run) => `deliveryId=${deliveryId(run) ?? 'null'}`,
    timeoutMessage: 'Timed out waiting for workflow run by delivery ID',
  });
}

export async function waitForRunTerminal(
  options: WaitForRunTerminalOptions,
): Promise<WorkflowRunDetailResponseDto> {
  const client = createApiClient({
    apiUrl: options.apiUrl,
    fetch: options.fetch,
    token: options.token,
  });
  const timeoutMs = options.timeoutMs ?? DEFAULT_TERMINAL_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let delayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  let lastResponse: WorkflowRunDetailResponseDto | null = null;

  while (Date.now() <= deadline) {
    options.signal?.throwIfAborted();
    lastResponse = await client.requestJson<WorkflowRunDetailResponseDto>(
      'get',
      `/workflows/runs/${encodeURIComponent(options.runId)}`,
      {signal: options.signal},
    );
    if (TERMINAL_STATUSES.has(lastResponse.status)) return lastResponse;

    await waitForNextPoll({deadline, delayMs, signal: options.signal});
    delayMs = nextDelay(delayMs, options);
  }

  throw new Error(
    `Timed out waiting for workflow run terminal status: ${formatRunDetailObserved(
      lastResponse,
      options.runId,
    )}`,
  );
}

export function createWorkflowsHelper(options: {
  apiUrl?: string | undefined;
  fetch?: ApiFetch | undefined;
  token: string;
}) {
  return {
    waitForRunByCommit: (params: Omit<WaitForRunByCommitOptions, 'apiUrl' | 'fetch' | 'token'>) =>
      waitForRunByCommit({...options, ...params}),
    waitForRunByDeliveryId: (
      params: Omit<WaitForRunByDeliveryIdOptions, 'apiUrl' | 'fetch' | 'token'>,
    ) => waitForRunByDeliveryId({...options, ...params}),
    waitForRunTerminal: (params: Omit<WaitForRunTerminalOptions, 'apiUrl' | 'fetch' | 'token'>) =>
      waitForRunTerminal({...options, ...params}),
  };
}

export type WorkflowsHelper = ReturnType<typeof createWorkflowsHelper>;
