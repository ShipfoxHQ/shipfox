import {configureApiClient, resetApiClient} from '@shipfox/client-api';
import {cleanup, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {WorkflowRunConcurrency, WorkflowRunStatus} from '#core/workflow-run.js';
import {
  runAttemptsResponseDto,
  workflowRunAttemptDto,
  workflowRunFixtureDto,
  workflowRunOverview,
  workflowRunOverviewResponseDto,
} from '#test/fixtures/workflow-run.js';
import {jsonResponse, PROJECT_TEST_WSLUG, renderProjectPage} from '#test/pages.js';
import {RunContextPanel} from './run-context-panel.js';

const CURRENT_RUN_ID = '66666666-6666-4666-8666-666666666666';
const RELATED_RUN_ID = '77777777-7777-4777-8777-777777777777';
const RELATED_ATTEMPT_ID = '88888888-8888-4888-8888-888888888888';

describe('RunContextPanel concurrency details', () => {
  afterEach(() => {
    cleanup();
    resetApiClient();
  });

  test('explains a shared waiting group and links to its holder attempt', async () => {
    const fetchImpl = relatedRunFetch();
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    await renderPanel(
      workflowConcurrency({state: 'waiting', scope: 'project', cancelInProgress: false}),
      'waiting',
    );

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', {name: 'Inspect run details'}));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Status').parentElement).toHaveTextContent('Waiting');
    expect(within(dialog).getByRole('heading', {name: 'Concurrency'})).toBeVisible();
    expect(within(dialog).getByText('deploy-production')).toBeInTheDocument();
    expect(within(dialog).getByText('Project · shared across workflows')).toBeInTheDocument();
    expect(within(dialog).getByText('Keep the running holder')).toBeInTheDocument();
    expect(within(dialog).getByText('Held by')).toBeInTheDocument();
    const holder = await within(dialog).findByRole('link', {
      name: 'Release run #42, attempt 3',
    });
    expect(holder).toHaveAttribute(
      'href',
      `/w/acme/p/platform/runs/${RELATED_RUN_ID}?runAttempt=3`,
    );
    expect(holder.closest('[aria-live="polite"]')).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('does not resolve related attempts when the concurrency state has no relation row', async () => {
    const fetchImpl = vi.fn();
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    await renderPanel(workflowConcurrency({state: 'acquired'}), 'running');

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', {name: 'Inspect run details'}));

    await screen.findByRole('dialog');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('names the replacement for a superseded attempt', async () => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: relatedRunFetch()});
    await renderPanel(workflowConcurrency({state: 'superseded'}), 'cancelled');

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', {name: 'Inspect run details'}));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Superseded by')).toBeInTheDocument();
    expect(
      await within(dialog).findByRole('link', {name: 'Release run #42, attempt 3'}),
    ).toBeInTheDocument();
  });

  test('degrades safely when a waiting claim has no holder identity', async () => {
    const fetchImpl = vi.fn();
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    await renderPanel(workflowConcurrency({state: 'waiting', affectedAttempts: []}), 'waiting');

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', {name: 'Inspect run details'}));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Held by')).toBeInTheDocument();
    expect(within(dialog).getByText('Related run unavailable')).toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test.each([403, 404])('degrades safely when a related run returns %s', async (status) => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(async () => jsonResponse({code: 'not_found'}, {status})),
    });
    await renderPanel(workflowConcurrency({state: 'superseded'}), 'cancelled');

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', {name: 'Inspect run details'}));

    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(within(dialog).getByText('Related run unavailable')).toBeInTheDocument(),
    );
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument();
  });
});

function renderPanel(concurrency: WorkflowRunConcurrency, status: WorkflowRunStatus) {
  const run = workflowRunOverview({
    id: CURRENT_RUN_ID,
    status,
    run_attempt: workflowRunAttemptDto({
      workflow_run_id: CURRENT_RUN_ID,
      status,
      concurrency: {
        display_group: concurrency.displayGroup,
        scope: concurrency.scope,
        state: concurrency.state,
        generation: concurrency.generation,
        policy: {cancel_in_progress: concurrency.cancelInProgress},
        affected_attempts: concurrency.affectedAttempts.map((attempt) => ({
          workflow_run_id: attempt.workflowRunId,
          workflow_run_attempt_id: attempt.workflowRunAttemptId,
        })),
      },
    }),
  });
  return renderProjectPage(`/w/${PROJECT_TEST_WSLUG}/p/platform/runs/${CURRENT_RUN_ID}`, () => (
    <RunContextPanel
      run={run}
      usage={undefined}
      workspaceSlug={PROJECT_TEST_WSLUG}
      projectSlug="platform"
    />
  ));
}

function workflowConcurrency(
  overrides: Partial<WorkflowRunConcurrency> = {},
): WorkflowRunConcurrency {
  return {
    displayGroup: 'deploy-production',
    scope: 'workflow',
    state: 'waiting',
    generation: 4,
    cancelInProgress: true,
    affectedAttempts: [{workflowRunId: RELATED_RUN_ID, workflowRunAttemptId: RELATED_ATTEMPT_ID}],
    ...overrides,
  };
}

function relatedRunFetch() {
  const attempts = runAttemptsResponseDto({
    items: [
      workflowRunAttemptDto({
        id: RELATED_ATTEMPT_ID,
        workflow_run_id: RELATED_RUN_ID,
        attempt: 3,
        status: 'running',
      }),
    ],
  });
  const overview = workflowRunOverviewResponseDto(
    workflowRunFixtureDto({
      id: RELATED_RUN_ID,
      number: 42,
      name: 'release-production',
      workflow_name: 'Release',
      current_attempt: 3,
      latest_attempt: 3,
      run_attempt: workflowRunAttemptDto({
        id: RELATED_ATTEMPT_ID,
        workflow_run_id: RELATED_RUN_ID,
        attempt: 3,
        status: 'running',
      }),
    }),
  );

  return vi.fn((input: RequestInfo | URL) => {
    const path = new URL(requestInputUrl(input)).pathname;
    if (path.endsWith('/attempts')) return Promise.resolve(jsonResponse(attempts));
    if (path.endsWith('/overview')) return Promise.resolve(jsonResponse(overview));
    return Promise.reject(new Error(`Unexpected request: ${path}`));
  });
}

function requestInputUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url;
  return String(input);
}
