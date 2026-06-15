import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen} from '@testing-library/react';
import {jsonResponse, PROJECT_TEST_WID, renderProjectPage} from '#test/pages.js';
import {ProjectRunDetailPage} from './project-run-detail-page.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const RUN_ID = '66666666-6666-4666-8666-666666666666';
const DEFINITION_ID = '55555555-5555-4555-8555-555555555555';
const SOURCE_TAB_RE = /Source/i;
const SOURCE_NAME_RE = /name: Deploy production/;
const BUILD_JOB_RE = /^build\s+succeeded/;
const ARTIFACT_OUTPUT_RE = /"artifact": "dist\/app\.tar\.gz"/;
const LOCKFILE_OUTPUT_RE = /"lockfile": "stale"/;
const ATTEMPT_1_RE = /Attempt 1 failed/;
const SELECT_ATTEMPT_1_RE = /Select attempt 1 failed/;
const CLEANUP_STEP_RE = /Cleanup/;
const MONITOR_JOB_RE = /^monitor\s+running/;
const DOCUMENT_JSON_RE = /"jobs"/;
const MODEL_JSON_RE = /"kind": "workflow"/;

describe('ProjectRunDetailPage', () => {
  test('renders the run detail frame from API data', async () => {
    configureApiClient({fetchImpl: createRunDetailFetch()});

    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs/${RUN_ID}`,
      <ProjectRunDetailPage projectId={PROJECT_ID} runId={RUN_ID} />,
    );

    expect(await screen.findByRole('heading', {name: 'Run 66666666'})).toBeInTheDocument();
    expect(screen.getAllByText('Runs')).not.toHaveLength(0);
    expect(screen.getByText('Jobs graph')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Re-run'})).toBeDisabled();
    expect(screen.getAllByText('deploy')).not.toHaveLength(0);
    expect(screen.getAllByText('Install')).not.toHaveLength(0);

    const sourceButtons = screen.getAllByRole('button', {name: SOURCE_TAB_RE});
    const sourceButton = sourceButtons.at(-1);
    if (!sourceButton) throw new Error('Source button not rendered');
    fireEvent.click(sourceButton);

    expect(screen.getByText('workflow.yaml')).toBeInTheDocument();
    expect(screen.getByText(SOURCE_NAME_RE)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'document'}));

    expect(screen.getByText('workflow_document.json')).toBeInTheDocument();
    expect(screen.getByText(DOCUMENT_JSON_RE)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'model'}));

    expect(screen.getByText('workflow_model.json')).toBeInTheDocument();
    expect(screen.getByText(MODEL_JSON_RE)).toBeInTheDocument();
  });

  test('filters the run rail by status and search text', async () => {
    configureApiClient({fetchImpl: createRunDetailFetch()});

    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs/${RUN_ID}`,
      <ProjectRunDetailPage projectId={PROJECT_ID} runId={RUN_ID} />,
    );

    expect(await screen.findByText('manual · Deploy production')).toBeInTheDocument();
    expect(screen.getByText('schedule · Nightly regression')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'running'}));

    expect(screen.queryByText('manual · Deploy production')).not.toBeInTheDocument();
    expect(screen.getByText('schedule · Nightly regression')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filter runs'), {target: {value: 'cleanup'}});

    expect(screen.getByText('No runs match.')).toBeInTheDocument();
  });

  test('updates the inspector when a different job is selected in the graph', async () => {
    configureApiClient({fetchImpl: createRunDetailFetch()});

    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs/${RUN_ID}`,
      <ProjectRunDetailPage projectId={PROJECT_ID} runId={RUN_ID} />,
    );

    expect(await screen.findByText('Root cause')).toBeInTheDocument();
    expect(screen.getByText('Package lock mismatch')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: BUILD_JOB_RE}));

    expect(screen.getAllByText('Compile assets')).not.toHaveLength(0);
    expect(screen.queryByText('Package lock mismatch')).not.toBeInTheDocument();
    expect(screen.getByText(ARTIFACT_OUTPUT_RE)).toBeInTheDocument();
  });

  test('shows attempt, gate, output, and empty-attempt details for selected steps', async () => {
    configureApiClient({fetchImpl: createRunDetailFetch()});

    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs/${RUN_ID}`,
      <ProjectRunDetailPage projectId={PROJECT_ID} runId={RUN_ID} />,
    );

    expect(await screen.findByText('Gate')).toBeInTheDocument();
    expect(screen.getByText('gate rejected deploy artifacts')).toBeInTheDocument();
    expect(screen.getByText(LOCKFILE_OUTPUT_RE)).toBeInTheDocument();

    const firstAttemptButton = screen.getByRole('button', {name: SELECT_ATTEMPT_1_RE});
    if (!firstAttemptButton) throw new Error('Attempt 1 button not rendered');
    fireEvent.click(firstAttemptButton);

    expect(screen.getByText('Registry timeout')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: CLEANUP_STEP_RE}));

    expect(screen.getByText('No attempts have been recorded for this step.')).toBeInTheDocument();
  });

  test('keeps the inspector tab while selecting another attempt', async () => {
    configureApiClient({fetchImpl: createRunDetailFetch()});

    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs/${RUN_ID}`,
      <ProjectRunDetailPage projectId={PROJECT_ID} runId={RUN_ID} />,
    );

    expect(await screen.findByText('Root cause')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Logs'}));
    expect(screen.getByText('attempt #2')).toBeInTheDocument();

    const firstAttemptButton = screen.getByRole('button', {name: ATTEMPT_1_RE});
    if (!firstAttemptButton) throw new Error('Attempt 1 button not rendered');
    fireEvent.click(firstAttemptButton);

    expect(await screen.findByText('attempt #1')).toBeInTheDocument();
    expect(screen.getByText('Registry timeout')).toBeInTheDocument();
  });

  test('filters and searches frontend-only fixture logs', async () => {
    configureApiClient({fetchImpl: createRunDetailFetch()});

    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs/${RUN_ID}`,
      <ProjectRunDetailPage projectId={PROJECT_ID} runId={RUN_ID} />,
    );

    expect(await screen.findByText('Root cause')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Logs'}));
    fireEvent.click(screen.getByRole('button', {name: 'stderr'}));

    expect(screen.getByText('Package lock mismatch')).toBeInTheDocument();
    expect(screen.queryByText('runner workspace prepared')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'All'}));
    fireEvent.change(screen.getByLabelText('Search logs'), {target: {value: 'workspace'}});

    expect(screen.getByText('runner workspace prepared')).toBeInTheDocument();
    expect(screen.queryByText('Package lock mismatch')).not.toBeInTheDocument();
  });

  test('shows the logs empty state for a step without attempts', async () => {
    configureApiClient({fetchImpl: createRunDetailFetch()});

    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs/${RUN_ID}`,
      <ProjectRunDetailPage projectId={PROJECT_ID} runId={RUN_ID} />,
    );

    expect(await screen.findByText('Root cause')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: CLEANUP_STEP_RE}));
    fireEvent.click(screen.getByRole('button', {name: 'Logs'}));

    expect(screen.getByText('Step not started')).toBeInTheDocument();
    expect(screen.getByText('No attempts were executed for this step.')).toBeInTheDocument();
  });

  test('shows the active step callout for a running job', async () => {
    configureApiClient({fetchImpl: createRunDetailFetch()});

    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs/${RUN_ID}`,
      <ProjectRunDetailPage projectId={PROJECT_ID} runId={RUN_ID} />,
    );

    await screen.findByText('Root cause');

    fireEvent.click(screen.getByRole('button', {name: MONITOR_JOB_RE}));

    expect(screen.getByText('Active step')).toBeInTheDocument();
    expect(screen.getByText('Currently running.')).toBeInTheDocument();
    expect(screen.getAllByText('Wait for health check')).not.toHaveLength(0);
  });

  test('returns to the root cause selection from another selected job', async () => {
    configureApiClient({fetchImpl: createRunDetailFetch()});

    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs/${RUN_ID}`,
      <ProjectRunDetailPage projectId={PROJECT_ID} runId={RUN_ID} />,
    );

    expect(await screen.findByText('Root cause')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: MONITOR_JOB_RE}));

    expect(screen.getByText('Active step')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Go to root cause'}));

    expect(screen.getByText('Root cause')).toBeInTheDocument();
    expect(screen.getByText('Package lock mismatch')).toBeInTheDocument();
  });

  test('shows an honest unavailable state for runs without a source snapshot', async () => {
    configureApiClient({
      fetchImpl: createRunDetailFetch({
        ...runDetailDto(),
        workflow_source_yaml: null,
        workflow_document: null,
        workflow_model: null,
      }),
    });

    renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs/${RUN_ID}`,
      <ProjectRunDetailPage projectId={PROJECT_ID} runId={RUN_ID} />,
    );

    const sourceButton = (await screen.findAllByRole('button', {name: SOURCE_TAB_RE})).at(-1);
    if (!sourceButton) throw new Error('Source button not rendered');
    fireEvent.click(sourceButton);

    expect(screen.getByText('Source snapshot unavailable')).toBeInTheDocument();
    expect(screen.queryByText('workflow.yaml')).not.toBeInTheDocument();
  });
});

function createRunDetailFetch(detail: unknown = runDetailDto()) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(requestInputUrl(input));

    if (url.pathname === `/workflows/runs/${RUN_ID}`) {
      return Promise.resolve(jsonResponse(detail));
    }
    if (url.pathname === '/workflows/runs') {
      return Promise.resolve(jsonResponse(runsDto()));
    }
    return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
  });
}

function requestInputUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return input.url;
  return String(input);
}

function runsDto() {
  return {
    runs: [
      runSummary(),
      runSummary({
        id: '77777777-7777-4777-8777-777777777777',
        name: 'Nightly regression',
        status: 'running',
        trigger_source: 'schedule',
        duration_ms: 0,
      }),
    ],
    next_cursor: null,
    filtered_total_count: 2,
  };
}

function runSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    project_id: PROJECT_ID,
    definition_id: DEFINITION_ID,
    name: 'Deploy production',
    status: 'failed',
    trigger_source: 'manual',
    trigger_event: 'fire',
    trigger_payload: {source: 'manual', event: 'fire'},
    inputs: null,
    duration_ms: 134_000,
    created_at: '2026-05-13T00:00:00.000Z',
    updated_at: '2026-05-13T00:02:14.000Z',
    ...overrides,
  };
}

function runDetailDto() {
  return {
    ...runsDto().runs[0],
    workflow_source_yaml:
      'name: Deploy production\njobs:\n  deploy:\n    steps:\n      - name: Install\n',
    workflow_document: {name: 'Deploy production', jobs: {deploy: {steps: [{name: 'Install'}]}}},
    workflow_model: {kind: 'workflow', name: 'Deploy production'},
    jobs: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        run_id: RUN_ID,
        name: 'build',
        status: 'succeeded',
        dependencies: [],
        position: 0,
        duration_ms: 52_000,
        created_at: '2026-05-13T00:00:00.000Z',
        updated_at: '2026-05-13T00:00:52.000Z',
        steps: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            job_id: '11111111-1111-4111-8111-111111111111',
            name: 'Compile assets',
            status: 'succeeded',
            type: 'run',
            config: {run: 'pnpm build'},
            error: null,
            position: 1,
            current_attempt: 1,
            duration_ms: 52_000,
            created_at: '2026-05-13T00:00:00.000Z',
            updated_at: '2026-05-13T00:00:52.000Z',
            attempts: [
              {
                id: '33333333-3333-4333-8333-333333333333',
                step_id: '22222222-2222-4222-8222-222222222222',
                job_id: '11111111-1111-4111-8111-111111111111',
                attempt: 1,
                status: 'succeeded',
                exit_code: 0,
                output: {artifact: 'dist/app.tar.gz'},
                error: null,
                gate_result: null,
                restart_reason: null,
                duration_ms: 52_000,
                started_at: '2026-05-13T00:00:00.000Z',
                finished_at: '2026-05-13T00:00:52.000Z',
              },
            ],
          },
        ],
      },
      {
        id: '77777777-7777-4777-8777-777777777777',
        run_id: RUN_ID,
        name: 'deploy',
        status: 'failed',
        dependencies: ['build'],
        position: 1,
        duration_ms: 134_000,
        created_at: '2026-05-13T00:00:00.000Z',
        updated_at: '2026-05-13T00:02:14.000Z',
        steps: [
          {
            id: '88888888-8888-4888-8888-888888888888',
            job_id: '77777777-7777-4777-8777-777777777777',
            name: 'Install',
            status: 'failed',
            type: 'run',
            config: {run: 'pnpm install'},
            error: {message: 'Package lock mismatch', reason: 'setup_aborted'},
            position: 1,
            current_attempt: 2,
            duration_ms: 42_000,
            created_at: '2026-05-13T00:00:00.000Z',
            updated_at: '2026-05-13T00:00:42.000Z',
            attempts: [
              {
                id: '99999999-9999-4999-8999-999999999999',
                step_id: '88888888-8888-4888-8888-888888888888',
                job_id: '77777777-7777-4777-8777-777777777777',
                attempt: 1,
                status: 'failed',
                exit_code: 1,
                output: null,
                error: {message: 'Registry timeout'},
                gate_result: null,
                restart_reason: 'retry install after registry timeout',
                duration_ms: 20_000,
                started_at: '2026-05-13T00:00:00.000Z',
                finished_at: '2026-05-13T00:00:20.000Z',
              },
              {
                id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                step_id: '88888888-8888-4888-8888-888888888888',
                job_id: '77777777-7777-4777-8777-777777777777',
                attempt: 2,
                status: 'failed',
                exit_code: 1,
                output: {lockfile: 'stale', attempt: 'retry'},
                error: {message: 'Package lock mismatch'},
                gate_result: {passed: false, expression: 'exit_code == 0', exit_code: 1},
                restart_reason: 'gate rejected deploy artifacts',
                duration_ms: 22_000,
                started_at: '2026-05-13T00:00:20.000Z',
                finished_at: '2026-05-13T00:00:42.000Z',
              },
            ],
          },
          {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            job_id: '77777777-7777-4777-8777-777777777777',
            name: 'Cleanup',
            status: 'pending',
            type: 'run',
            config: {run: 'pnpm cleanup'},
            error: null,
            position: 2,
            current_attempt: 1,
            duration_ms: 0,
            created_at: '2026-05-13T00:00:42.000Z',
            updated_at: '2026-05-13T00:00:42.000Z',
            attempts: [],
          },
        ],
      },
      {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        run_id: RUN_ID,
        name: 'monitor',
        status: 'running',
        dependencies: ['deploy'],
        position: 2,
        duration_ms: 0,
        created_at: '2026-05-13T00:02:00.000Z',
        updated_at: '2026-05-13T00:02:14.000Z',
        steps: [
          {
            id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            job_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            name: 'Wait for health check',
            status: 'running',
            type: 'run',
            config: {run: 'curl --fail https://shipfox.example/health'},
            error: null,
            position: 1,
            current_attempt: 1,
            duration_ms: 0,
            created_at: '2026-05-13T00:02:00.000Z',
            updated_at: '2026-05-13T00:02:14.000Z',
            attempts: [
              {
                id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
                step_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
                job_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                attempt: 1,
                status: 'running',
                exit_code: null,
                output: null,
                error: null,
                gate_result: null,
                restart_reason: null,
                duration_ms: 0,
                started_at: '2026-05-13T00:02:00.000Z',
                finished_at: null,
              },
            ],
          },
        ],
      },
    ],
  };
}
