import type {RunDetailResponseDto, RunListResponseDto} from '@shipfox/api-workflows-dto';
import {configureApiClient} from '@shipfox/client-api';
import {type InfiniteData, QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, cleanup, renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {toWorkflowRun} from '#core/workflow-run.js';
import {
  runAttemptsResponseDto,
  workflowJobDto,
  workflowRunAttemptDto,
  workflowRunDetailDto,
  workflowRunDto,
  workflowRunListResponseDto,
} from '#test/fixtures/workflow-run.js';
import {
  useCancelWorkflowRunMutation,
  useRerunWorkflowRunMutation,
  useWorkflowRunAttemptsQuery,
  useWorkflowRunQuery,
  useWorkflowRunsInfiniteQuery,
  workflowRunsQueryKeys,
} from './workflow-runs.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const RUN_ID = '66666666-6666-4666-8666-666666666666';
const ROOT_RUN_ID = '77777777-7777-4777-8777-777777777777';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

function renderWithQueryClient<T>(callback: () => T) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return {queryClient, ...renderHook(callback, {wrapper})};
}

describe('workflow run API hooks', () => {
  afterEach(() => {
    cleanup();
    configureApiClient({baseUrl: '', fetchImpl: undefined});
  });

  test('maps list DTO pages to workflow run models while keeping the cache DTO-shaped', async () => {
    const body = workflowRunListResponseDto({
      runs: [
        workflowRunDto({
          id: RUN_ID,
          trigger_source: 'github',
          trigger_event: 'push',
          updated_at: '2026-05-07T01:02:00.000Z',
        }),
      ],
      next_cursor: 'cursor-2',
      filtered_total_count: 8,
    });
    const fetchImpl = vi.fn(async () => jsonResponse(body));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result, queryClient} = renderWithQueryClient(() =>
      useWorkflowRunsInfiniteQuery(PROJECT_ID, {}),
    );

    await waitFor(() =>
      expect(result.current.data?.pages[0]?.runs[0]?.triggerSource).toBe('github'),
    );
    expect(result.current.data?.pages[0]?.runs[0]).toMatchObject({
      id: RUN_ID,
      triggerSource: 'github',
      triggerEvent: 'push',
      triggerLabel: 'github / push',
      updatedAt: '2026-05-07T01:02:00.000Z',
      isTemporary: false,
    });
    expect(result.current.data?.pages[0]?.nextCursor).toBe('cursor-2');
    expect(result.current.data?.pages[0]?.filteredTotalCount).toBe(8);

    const cached = queryClient.getQueryData<InfiniteData<RunListResponseDto, string | undefined>>(
      workflowRunsQueryKeys.list(PROJECT_ID, {}),
    );
    expect(cached?.pages[0]?.runs[0]).toMatchObject({
      trigger_source: 'github',
      trigger_event: 'push',
      updated_at: '2026-05-07T01:02:00.000Z',
    });
    expect(cached?.pages[0]).not.toHaveProperty('nextCursor');
  });

  test('maps detail DTOs to nested workflow run detail models while keeping the cache DTO-shaped', async () => {
    const body = workflowRunDetailDto({
      id: RUN_ID,
      trigger_source: 'manual',
      trigger_event: 'fire',
      jobs: [workflowJobDto({run_id: RUN_ID, name: 'build'})],
    });
    const fetchImpl = vi.fn(async () => jsonResponse(body));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result, queryClient} = renderWithQueryClient(() => useWorkflowRunQuery(RUN_ID));

    await waitFor(() => expect(result.current.data?.triggerSource).toBe('manual'));
    expect(result.current.data).toMatchObject({
      id: RUN_ID,
      triggerSource: 'manual',
      triggerEvent: 'fire',
      triggerLabel: 'manual / fire',
      jobs: [{name: 'build', runId: RUN_ID}],
    });

    const cached = queryClient.getQueryData<RunDetailResponseDto>(
      workflowRunsQueryKeys.detail(RUN_ID),
    );
    expect(cached).toMatchObject({
      id: RUN_ID,
      trigger_source: 'manual',
      trigger_event: 'fire',
      jobs: [{name: 'build', run_id: RUN_ID}],
    });
    expect(cached).not.toHaveProperty('triggerSource');
  });

  test('maps run attempts and caches them by root run id', async () => {
    const body = runAttemptsResponseDto({
      attempts: [
        workflowRunAttemptDto({
          id: ROOT_RUN_ID,
          attempt: 1,
          status: 'succeeded',
          created_at: '2026-05-07T01:00:00.000Z',
        }),
        workflowRunAttemptDto({
          id: RUN_ID,
          attempt: 2,
          status: 'failed',
          created_at: '2026-05-07T01:02:00.000Z',
          rerun_mode: 'all',
        }),
      ],
    });
    const fetchImpl = vi.fn(async () => jsonResponse(body));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result, queryClient} = renderWithQueryClient(() =>
      useWorkflowRunAttemptsQuery({runId: RUN_ID, rootRunId: ROOT_RUN_ID, enabled: true}),
    );

    await waitFor(() => expect(result.current.data?.[1]?.attempt).toBe(2));
    expect(result.current.data?.[1]).toMatchObject({
      id: RUN_ID,
      status: 'failed',
      createdAt: '2026-05-07T01:02:00.000Z',
      rerunMode: 'all',
    });
    expect(firstRequest(fetchImpl).url).toBe(
      `https://api.example.test/workflows/runs/${RUN_ID}/attempts`,
    );
    expect(queryClient.getQueryData(workflowRunsQueryKeys.attempts(ROOT_RUN_ID))).toEqual(body);
  });

  test('does not fetch run attempts while disabled', () => {
    const fetchImpl = vi.fn(async () => jsonResponse(runAttemptsResponseDto()));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderWithQueryClient(() =>
      useWorkflowRunAttemptsQuery({runId: RUN_ID, rootRunId: ROOT_RUN_ID, enabled: false}),
    );

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('cancels a workflow run and invalidates detail and list queries', async () => {
    const body = workflowRunDto({id: RUN_ID, project_id: PROJECT_ID, status: 'cancelled'});
    const fetchImpl = vi.fn(async () => jsonResponse(body));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const run = workflowRunDto({id: RUN_ID, project_id: PROJECT_ID, status: 'running'});
    const {result, queryClient} = renderWithQueryClient(() =>
      useCancelWorkflowRunMutation(toWorkflowRun(run)),
    );
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    let cancelled: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      cancelled = await result.current.mutateAsync();
    });

    const calls = fetchImpl.mock.calls as unknown as Array<[Request]>;
    const request = calls[0]?.[0];
    if (!request) throw new Error('Expected cancel request');
    expect(request.url).toBe(
      'https://api.example.test/workflows/runs/66666666-6666-4666-8666-666666666666/cancel',
    );
    expect(request.method).toBe('POST');
    expect(cancelled?.status).toBe('cancelled');
    expect(invalidateSpy).toHaveBeenCalledWith({queryKey: workflowRunsQueryKeys.detail(RUN_ID)});
    expect(invalidateSpy).toHaveBeenCalledWith({queryKey: workflowRunsQueryKeys.lists(PROJECT_ID)});
  });

  test('posts rerun mode and invalidates project run lists and attempt lineage', async () => {
    const postBodies: unknown[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      postBodies.push(await request.clone().json());
      return jsonResponse(
        workflowRunDto({
          id: '77777777-7777-4777-8777-777777777777',
          root_run_id: ROOT_RUN_ID,
          status: 'pending',
        }),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result, queryClient} = renderWithQueryClient(() =>
      useRerunWorkflowRunMutation(PROJECT_ID),
    );
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({runId: RUN_ID, mode: 'failed'});
    });

    const request = firstRequest(fetchImpl);
    expect(request.url).toBe(`https://api.example.test/workflows/runs/${RUN_ID}/rerun`);
    expect(request.method).toBe('POST');
    expect(postBodies).toEqual([{mode: 'failed'}]);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: workflowRunsQueryKeys.lists(PROJECT_ID),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: workflowRunsQueryKeys.attempts(ROOT_RUN_ID),
    });
  });
});

function firstRequest(fetchImpl: ReturnType<typeof vi.fn>): Request {
  const input = (fetchImpl.mock.calls as unknown[][])[0]?.[0];
  if (!(input instanceof Request)) throw new Error('Expected fetch to receive a Request');
  return input;
}
