import {configureApiClient} from '@shipfox/client-api';
import {type StepLogSnapshot, stepLogsQueryKeys} from '@shipfox/client-logs';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import {StepAttemptLogPanel} from './step-attempt-log-panel.js';

const STEP_ID = '99999999-9999-4999-8999-999999999999';
type TestLogRecord = StepLogSnapshot['records'][number];

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

const outputLine = (data: string, ts = 1): string =>
  `${JSON.stringify({v: 1, ts, type: 'output', stream: 'stdout', data})}\n`;

const inlineBody = (ndjson: string, nextCursor: number) => ({
  mode: 'inline',
  ndjson,
  next_cursor: nextCursor,
  has_more: false,
  state: 'closed',
  truncated: false,
});

const outputRecord = (data: string, ts = 1): TestLogRecord => ({
  v: 1,
  ts,
  type: 'output',
  stream: 'stdout',
  data,
});

function snapshot(records: TestLogRecord[]): StepLogSnapshot {
  return {
    records,
    nextCursor: records.length,
    source: 'inline',
    state: 'closed',
    complete: true,
    hasMore: false,
    truncated: false,
    totalBytes: null,
    expiresAt: null,
  };
}

function renderPanel(
  props: Partial<Parameters<typeof StepAttemptLogPanel>[0]> = {},
  options: {queryClient?: QueryClient} = {},
) {
  const queryClient =
    options.queryClient ??
    new QueryClient({
      defaultOptions: {queries: {retry: false}},
    });
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return {
    queryClient,
    ...render(
      <StepAttemptLogPanel stepId={STEP_ID} attempt={1} attemptStatus="running" {...props} />,
      {wrapper},
    ),
  };
}

describe('StepAttemptLogPanel', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    configureApiClient({baseUrl: '', fetchImpl: undefined});
  });

  test('waits for missing logs while the attempt is running', async () => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(async () => jsonResponse({code: 'not-found'}, {status: 404})),
    });

    renderPanel();

    expect(await screen.findByRole('status', {name: 'Waiting for logs'})).toBeInTheDocument();
  });

  test('shows a compact retry state for an initial server error', async () => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(async () => jsonResponse({code: 'server-error'}, {status: 500})),
    });

    renderPanel({attemptStatus: 'failed'});

    expect(await screen.findByText('Could not load logs.')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Retry'})).toBeInTheDocument();
  });

  test('renders loaded logs inline', async () => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(async () => jsonResponse(inlineBody(outputLine('hello\n'), 1))),
    });

    renderPanel({attemptStatus: 'succeeded'});

    expect(await screen.findByRole('log')).toHaveTextContent('hello');
  });

  test('keeps stale logs visible when a refresh fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(inlineBody(outputLine('first\n'), 1)))
      .mockResolvedValueOnce(jsonResponse({code: 'server-error'}, {status: 500}));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const {queryClient} = renderPanel({attemptStatus: 'running'});
    await screen.findByText('first');

    await act(async () => {
      await queryClient.refetchQueries({queryKey: stepLogsQueryKeys.detail(STEP_ID, 1)});
    });

    expect(screen.getByText('first')).toBeInTheDocument();
    expect(await screen.findByText('Could not refresh logs.')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Retry'})).toBeInTheDocument();
  });

  test('does not follow new log output after the user scrolls away from the tail', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: vi.fn()});
    const queryClient = new QueryClient({
      defaultOptions: {queries: {retry: false, staleTime: Number.POSITIVE_INFINITY}},
    });
    const queryKey = stepLogsQueryKeys.detail(STEP_ID, 1);
    queryClient.setQueryData(queryKey, snapshot([outputRecord('first\n')]));
    renderPanel({attemptStatus: 'succeeded'}, {queryClient});
    const logRows = await screen.findByRole('log');
    Object.defineProperty(logRows, 'scrollHeight', {configurable: true, value: 600});
    Object.defineProperty(logRows, 'clientHeight', {configurable: true, value: 200});
    logRows.scrollTop = 320;
    fireEvent.scroll(logRows);

    act(() => {
      queryClient.setQueryData(
        queryKey,
        snapshot([outputRecord('first\n'), outputRecord('second\n', 2)]),
      );
    });

    await waitFor(() => expect(screen.getByText('second')).toBeInTheDocument());
    expect(logRows.scrollTop).toBe(320);
  });
});
