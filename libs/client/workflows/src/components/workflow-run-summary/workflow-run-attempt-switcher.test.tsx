import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {ReactNode} from 'react';
import {
  runAttemptsResponseDto,
  workflowRun,
  workflowRunAttemptDto,
} from '#test/fixtures/workflow-run.js';
import {jsonResponse} from '#test/pages.js';
import {WorkflowRunAttemptSwitcher} from './workflow-run-attempt-switcher.js';

const ROOT_RUN_ID = '11111111-1111-4111-8111-111111111111';
const CURRENT_RUN_ID = '22222222-2222-4222-8222-222222222222';
const THIRD_RUN_ID = '33333333-3333-4333-8333-333333333333';
const SWITCH_ATTEMPT_PATTERN = /Switch attempt/;
const ATTEMPT_1_PATTERN = /Attempt 1/;
const ATTEMPT_2_PATTERN = /Attempt 2/;
const ATTEMPT_3_PATTERN = /Attempt 3/;

describe('WorkflowRunAttemptSwitcher', () => {
  afterEach(() => {
    configureApiClient({baseUrl: '', fetchImpl: undefined});
  });

  test('hides itself for a single-attempt run', () => {
    renderSwitcher({latestAttempt: 1});

    expect(screen.queryByRole('button', {name: SWITCH_ATTEMPT_PATTERN})).not.toBeInTheDocument();
  });

  test('shows a loading row while attempts are loading', async () => {
    const user = userEvent.setup();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(() => new Promise<Response>(() => undefined)),
    });
    renderSwitcher();

    await user.click(screen.getByRole('button', {name: 'Switch attempt, currently 2 of 4'}));

    expect(await screen.findByText('Loading attempts...')).toBeInTheDocument();
  });

  test('shows an error row when attempts fail to load', async () => {
    const user = userEvent.setup();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}))),
    });
    renderSwitcher();

    await user.click(screen.getByRole('button', {name: 'Switch attempt, currently 2 of 4'}));

    expect(
      await screen.findByRole('menuitem', {name: 'Could not load attempts. Retry'}),
    ).toBeInTheDocument();
  });

  test('lists attempts newest first, updates the max attempt, and marks the current row', async () => {
    const user = userEvent.setup();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            runAttemptsResponseDto({
              attempts: [
                workflowRunAttemptDto({
                  id: ROOT_RUN_ID,
                  attempt: 1,
                  status: 'succeeded',
                  created_at: '2026-05-07T01:00:00.000Z',
                }),
                workflowRunAttemptDto({
                  id: CURRENT_RUN_ID,
                  attempt: 2,
                  status: 'failed',
                  created_at: '2026-05-07T01:02:00.000Z',
                  rerun_mode: 'all',
                }),
                workflowRunAttemptDto({
                  id: THIRD_RUN_ID,
                  attempt: 3,
                  status: 'running',
                  created_at: '2026-05-07T01:03:00.000Z',
                  rerun_mode: 'failed',
                }),
              ],
            }),
          ),
        ),
      ),
    });
    renderSwitcher();

    await user.click(screen.getByRole('button', {name: 'Switch attempt, currently 2 of 4'}));

    await waitFor(() => expect(screen.getByText('Attempt 2 of 3')).toBeInTheDocument());
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(ATTEMPT_3_PATTERN),
        expect.stringMatching(ATTEMPT_2_PATTERN),
        expect.stringMatching(ATTEMPT_1_PATTERN),
      ]),
    );
    expect(items[0]).toHaveTextContent('Attempt 3');
    expect(items[1]).toHaveTextContent('Attempt 2');
    expect(items[2]).toHaveTextContent('Attempt 1');
    const current = screen.getByRole('menuitem', {name: ATTEMPT_2_PATTERN});
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(current).toHaveClass('bg-background-highlight-base');
    expect(within(current).getByRole('img', {name: 'Failed'})).toBeInTheDocument();
  });

  test('selects an attempt', async () => {
    const user = userEvent.setup();
    const onSelectAttempt = vi.fn();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            runAttemptsResponseDto({
              attempts: [
                workflowRunAttemptDto({id: ROOT_RUN_ID, attempt: 1}),
                workflowRunAttemptDto({id: CURRENT_RUN_ID, attempt: 2}),
              ],
            }),
          ),
        ),
      ),
    });
    renderSwitcher({onSelectAttempt});

    await user.click(screen.getByRole('button', {name: 'Switch attempt, currently 2 of 4'}));
    await user.click(await screen.findByRole('menuitem', {name: ATTEMPT_1_PATTERN}));

    expect(onSelectAttempt).toHaveBeenCalledWith(ROOT_RUN_ID);
  });
});

function renderSwitcher({
  latestAttempt = 4,
  onSelectAttempt = vi.fn(),
}: {
  latestAttempt?: number | undefined;
  onSelectAttempt?: ((runId: string) => void) | undefined;
} = {}) {
  const run = workflowRun({
    id: CURRENT_RUN_ID,
    root_run_id: ROOT_RUN_ID,
    attempt: 2,
  });
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  render(
    <WorkflowRunAttemptSwitcher
      run={run}
      latestAttempt={latestAttempt}
      onSelectAttempt={onSelectAttempt}
    />,
    {wrapper},
  );
}
