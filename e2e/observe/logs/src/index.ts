import {type LogRecord, parseLogRecordLine, type ReadLogsResponseDto} from '@shipfox/api-logs-dto';
import {type ApiFetch, createApiClient, E2eApiError} from '@shipfox/e2e-core';

const NDJSON_LINE_SPLIT_RE = /\r?\n/u;
const MISSING_STREAM_RETRY_DELAY_MS = 750;
const MISSING_STREAM_RETRY_TIMEOUT_MS = 60_000;

export interface FetchStepLogsOptions {
  apiUrl?: string | undefined;
  attempt: number;
  fetch?: ApiFetch | undefined;
  missingStreamRetryDelayMs?: number | undefined;
  missingStreamRetryTimeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
  stepId: string;
  token: string;
}

export interface StepLogs {
  ndjson: string;
  records: LogRecord[];
  truncated: boolean;
}

function parseLogNdjson(ndjson: string): LogRecord[] {
  return ndjson
    .split(NDJSON_LINE_SPLIT_RE)
    .filter((line) => line.length > 0)
    .map((line) => parseLogRecordLine(line));
}

async function readPresignedLogObject(params: {
  fetchImpl: ApiFetch;
  signal?: AbortSignal | undefined;
  url: string;
}): Promise<string> {
  const requestInit: RequestInit = {};
  if (params.signal) requestInit.signal = params.signal;
  const response = await params.fetchImpl(new URL(params.url), requestInit);
  if (!response.ok) {
    throw new Error(`Could not read presigned step logs: ${response.status}`);
  }
  return await response.text();
}

export async function fetchStepLogs(options: FetchStepLogsOptions): Promise<StepLogs> {
  options.signal?.throwIfAborted();
  const fetchImpl = options.fetch ?? fetch;
  const client = createApiClient({
    apiUrl: options.apiUrl,
    fetch: fetchImpl,
    token: options.token,
  });
  let cursor = 0;
  let ndjson = '';
  let truncated = false;
  const missingStreamRetryDelayMs =
    options.missingStreamRetryDelayMs ?? MISSING_STREAM_RETRY_DELAY_MS;
  const missingStreamRetryDeadline =
    Date.now() + (options.missingStreamRetryTimeoutMs ?? MISSING_STREAM_RETRY_TIMEOUT_MS);

  while (true) {
    options.signal?.throwIfAborted();
    const params = new URLSearchParams({cursor: String(cursor)});
    let response: ReadLogsResponseDto;
    try {
      response = await client.requestJson<ReadLogsResponseDto>(
        'get',
        `/steps/${encodeURIComponent(options.stepId)}/attempts/${options.attempt}/logs?${params}`,
        {signal: options.signal},
      );
    } catch (error) {
      if (cursor === 0 && isMissingStreamError(error) && Date.now() < missingStreamRetryDeadline) {
        await delay(
          Math.min(missingStreamRetryDelayMs, missingStreamRetryDeadline - Date.now()),
          options.signal,
        );
        continue;
      }
      throw error;
    }

    truncated ||= response.truncated;

    if (response.mode === 'presigned') {
      ndjson += await readPresignedLogObject({
        fetchImpl,
        signal: options.signal,
        url: response.url,
      });
      break;
    }

    ndjson += response.ndjson;
    cursor = response.next_cursor;
    if (!response.has_more) break;
  }

  return {
    ndjson,
    records: parseLogNdjson(ndjson),
    truncated,
  };
}

function isMissingStreamError(error: unknown): boolean {
  return (
    error instanceof E2eApiError &&
    error.status === 404 &&
    typeof error.details === 'object' &&
    error.details !== null &&
    'code' in error.details &&
    error.details.code === 'not-found'
  );
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      {once: true},
    );
  });
}

export function createLogsHelper(options: {
  apiUrl?: string | undefined;
  fetch?: ApiFetch | undefined;
  token: string;
}) {
  return {
    fetchStepLogs: (params: Omit<FetchStepLogsOptions, 'apiUrl' | 'fetch' | 'token'>) =>
      fetchStepLogs({...options, ...params}),
  };
}

export type LogsHelper = ReturnType<typeof createLogsHelper>;
