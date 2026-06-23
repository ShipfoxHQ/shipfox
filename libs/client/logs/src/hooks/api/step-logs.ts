import type {ReadLogsResponseDto} from '@shipfox/api-logs-dto';
import {apiRequest} from '@shipfox/client-api';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {mergeLogRead, type StepLogSnapshot, stepLogRefetchInterval} from '#core/log-read.js';

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

export function useStepAttemptLogsQuery(stepId: string | undefined, attempt: number | undefined) {
  const queryClient = useQueryClient();
  const enabled = Boolean(stepId && attempt && Number.isInteger(attempt) && attempt > 0);
  const queryKey =
    enabled && stepId && attempt
      ? stepLogsQueryKeys.detail(stepId, attempt)
      : [...stepLogsQueryKeys.all, 'detail'];

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
    refetchInterval: (query) => stepLogRefetchInterval(query.state.data),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: (query) => !query.state.data?.complete,
    refetchOnReconnect: (query) => !query.state.data?.complete,
  });
}
