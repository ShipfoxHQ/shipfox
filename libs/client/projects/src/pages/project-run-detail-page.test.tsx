import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen} from '@testing-library/react';
import {jsonResponse, PROJECT_TEST_WID, renderProjectPage} from '#test/pages.js';
import {ProjectRunDetailPage} from './project-run-detail-page.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const RUN_ID = '66666666-6666-4666-8666-666666666666';
const DEFINITION_ID = '55555555-5555-4555-8555-555555555555';
const SOURCE_TAB_RE = /Source/i;
const SOURCE_NAME_RE = /name: Deploy production/;

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
    expect(screen.getAllByText('deploy')).not.toHaveLength(0);
    expect(screen.getByText('Install')).toBeInTheDocument();

    const sourceButtons = screen.getAllByRole('button', {name: SOURCE_TAB_RE});
    const sourceButton = sourceButtons.at(-1);
    if (!sourceButton) throw new Error('Source button not rendered');
    fireEvent.click(sourceButton);

    expect(screen.getByText('workflow.yaml')).toBeInTheDocument();
    expect(screen.getByText(SOURCE_NAME_RE)).toBeInTheDocument();
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
});

function createRunDetailFetch() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(requestInputUrl(input));

    if (url.pathname === `/workflows/runs/${RUN_ID}`) {
      return Promise.resolve(jsonResponse(runDetailDto()));
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
        id: '77777777-7777-4777-8777-777777777777',
        run_id: RUN_ID,
        name: 'deploy',
        status: 'failed',
        dependencies: [],
        position: 0,
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
            error: {message: 'Install failed', reason: 'command_failed'},
            position: 1,
            current_attempt: 1,
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
                error: {message: 'Install failed'},
                gate_result: null,
                restart_reason: null,
                duration_ms: 42_000,
                started_at: '2026-05-13T00:00:00.000Z',
                finished_at: '2026-05-13T00:00:42.000Z',
              },
            ],
          },
        ],
      },
    ],
  };
}
