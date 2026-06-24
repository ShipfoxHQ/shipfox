import type {ReadLogsResponseDto} from '@shipfox/api-logs-dto';
import {ApiError, apiRequest} from '@shipfox/client-api';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {
  mergeLogRead,
  STEP_LOG_LIVE_REFETCH_MS,
  type StepLogSnapshot,
  stepLogRefetchInterval,
} from '#core/log-read.js';

export const stepLogsQueryKeys = {
  all: ['step-logs'] as const,
  detail: (stepId: string, attempt: number) =>
    [...stepLogsQueryKeys.all, 'detail', stepId, attempt] as const,
};

interface ReadStepAttemptLogsPageParams {
  stepId: string;
  attempt: number;
  cursor: number;
  signal?: AbortSignal;
}

export async function readStepAttemptLogsPage({
  stepId,
  attempt,
  cursor,
  signal,
}: ReadStepAttemptLogsPageParams): Promise<ReadLogsResponseDto> {
  const params = new URLSearchParams({cursor: String(cursor)});
  return await apiRequest<ReadLogsResponseDto>(
    `/steps/${encodeURIComponent(stepId)}/attempts/${attempt}/logs?${params.toString()}`,
    {signal},
  );
}

class StepLogObjectFetchError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Could not load compacted logs (${status})`);
    this.name = 'StepLogObjectFetchError';
    this.status = status;
  }
}

async function readPresignedLogObject(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, signal ? {signal} : undefined);
  if (!response.ok) throw new StepLogObjectFetchError(response.status);
  return await response.text();
}

export function isMissingStepLogStreamError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.code === 'not-found';
}

export interface UseStepAttemptLogsQueryOptions {
  retryMissingStream?: boolean;
  initialErrorRetryCount?: number;
  initialErrorRetryDelayMs?: number;
}

export function useStepAttemptLogsQuery(
  stepId: string | undefined,
  attempt: number | undefined,
  options: UseStepAttemptLogsQueryOptions = {},
) {
  const queryClient = useQueryClient();
  const enabled = Boolean(stepId && attempt && Number.isInteger(attempt) && attempt > 0);
  const queryKey =
    enabled && stepId && attempt
      ? stepLogsQueryKeys.detail(stepId, attempt)
      : [...stepLogsQueryKeys.all, 'detail'];
  const initialErrorRetryCount = options.initialErrorRetryCount ?? 0;
  const initialErrorRetryDelayMs = options.initialErrorRetryDelayMs ?? STEP_LOG_LIVE_REFETCH_MS;

  return useQuery({
    queryKey,
    enabled,
    queryFn: async ({signal}) => {
      const previous = queryClient.getQueryData<StepLogSnapshot>(queryKey);
      const response = await readStepAttemptLogsPage({
        stepId: stepId ?? '',
        attempt: attempt ?? 0,
        cursor: previous?.nextCursor ?? 0,
        signal,
      });

      if (response.mode === 'presigned') {
        const ndjson = await readPresignedLogObject(response.url, signal);
        return mergeLogRead(previous, {mode: 'presigned', response, ndjson});
      }

      return mergeLogRead(previous, {mode: 'inline', response});
    },
    retry: (failureCount, error) => {
      if (initialErrorRetryCount <= 0) return false;
      if (queryClient.getQueryData<StepLogSnapshot>(queryKey) !== undefined) return false;
      if (options.retryMissingStream && isMissingStepLogStreamError(error)) return false;
      return failureCount < initialErrorRetryCount;
    },
    retryDelay: initialErrorRetryDelayMs,
    refetchInterval: (query) => {
      if (
        options.retryMissingStream &&
        query.state.data === undefined &&
        isMissingStepLogStreamError(query.state.error)
      ) {
        return STEP_LOG_LIVE_REFETCH_MS;
      }

      return stepLogRefetchInterval(query.state.data, query.state.status === 'error');
    },
    refetchIntervalInBackground: false,
    refetchOnMount: (query) => !query.state.data?.complete,
    refetchOnWindowFocus: (query) => !query.state.data?.complete,
    refetchOnReconnect: (query) => !query.state.data?.complete,
  });
}
