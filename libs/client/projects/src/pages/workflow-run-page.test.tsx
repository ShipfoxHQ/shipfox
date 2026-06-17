import {configureApiClient} from '@shipfox/client-api';
import {screen} from '@testing-library/react';
import {jsonResponse, PROJECT_TEST_WID, renderProjectPage} from '#test/pages.js';
import {WorkflowRunPage} from './workflow-run-page.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const RUN_ID = '66666666-6666-4666-8666-666666666666';
const OTHER_RUN_ID = '77777777-7777-4777-8777-777777777777';
const DEFINITION_ID = '55555555-5555-4555-8555-555555555555';
const JOB_ID = '88888888-8888-4888-8888-888888888888';
const STEP_ID = '99999999-9999-4999-8999-999999999999';

describe('WorkflowRunPage', () => {
  test('renders a loading shell while run history loads', async () => {
    configureApiClient({fetchImpl: vi.fn(() => new Promise<Response>(() => undefined))});

    renderWorkflowRunPage(RUN_ID);

    expect(await screen.findByLabelText('Loading workflow run')).toBeInTheDocument();
    expect(screen.getByText(RUN_ID)).toBeInTheDocument();
  });

  test('renders an error state when run history cannot load', async () => {
    configureApiClient({
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}))),
    });

    renderWorkflowRunPage(RUN_ID);

    expect(await screen.findByText("Couldn't load workflow run")).toBeInTheDocument();
  });

  test('renders not found when the selected run is absent from loaded history', async () => {
    configureApiClient({fetchImpl: createWorkflowRunFetch({runs: [runDto({id: OTHER_RUN_ID})]})});

    renderWorkflowRunPage(RUN_ID);

    expect(await screen.findByText('Run not found')).toBeInTheDocument();
    expect(
      screen.getByText(`This run is not available in the current run history: ${RUN_ID}.`),
    ).toBeInTheDocument();
  });

  test('renders selected run identity, status, and composed sections', async () => {
    configureApiClient({fetchImpl: createWorkflowRunFetch()});

    renderWorkflowRunPage(RUN_ID, {selectedJobId: JOB_ID, selectedStepId: STEP_ID});

    expect(await screen.findByLabelText('Workflow run details')).toBeInTheDocument();
    expect(screen.getAllByText('Deploy production')).not.toHaveLength(0);
    expect(screen.getAllByText('Running')).not.toHaveLength(0);
    expect(screen.getByRole('region', {name: 'Workflow jobs'})).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'build · Steps'})).toBeInTheDocument();
    expect(screen.getByLabelText('Step overview')).toBeInTheDocument();
    expect(screen.getByLabelText('Workflow source')).toBeInTheDocument();
    expect(screen.getAllByText('pnpm build')).not.toHaveLength(0);
  });
});

function renderWorkflowRunPage(
  runId: string,
  options: {selectedJobId?: string; selectedStepId?: string} = {},
) {
  renderProjectPage(
    `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs/${runId}`,
    <WorkflowRunPage projectId={PROJECT_ID} runId={runId} {...options} />,
  );
}

function createWorkflowRunFetch({runs = [runDto()]}: {runs?: unknown[]} = {}) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(requestInputUrl(input));

    if (url.pathname === '/workflows/runs') {
      return Promise.resolve(
        jsonResponse({runs, next_cursor: null, filtered_total_count: runs.length}),
      );
    }

    if (url.pathname === `/workflows/runs/${RUN_ID}`) {
      return Promise.resolve(jsonResponse(runDetailDto()));
    }

    return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
  });
}

function requestInputUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return input.url;
  return String(input);
}

function runDto(overrides: Partial<{id: string; name: string; status: string}> = {}) {
  return {
    id: overrides.id ?? RUN_ID,
    project_id: PROJECT_ID,
    definition_id: DEFINITION_ID,
    name: overrides.name ?? 'Deploy production',
    status: overrides.status ?? 'running',
    trigger_source: 'manual',
    trigger_event: 'fire',
    trigger_payload: {source: 'manual', event: 'fire'},
    inputs: null,
    source_snapshot: null,
    created_at: '2026-05-07T01:01:00.000Z',
    updated_at: '2026-05-07T01:02:00.000Z',
  };
}

function runDetailDto() {
  return {
    ...runDto(),
    source_snapshot: {
      content: [
        'name: Deploy production',
        'jobs:',
        '  build:',
        '    steps:',
        '      - run: pnpm build',
      ].join('\n'),
      format: 'yaml',
    },
    jobs: [
      {
        id: JOB_ID,
        run_id: RUN_ID,
        name: 'build',
        status: 'running',
        dependencies: [],
        position: 0,
        created_at: '2026-05-07T01:01:00.000Z',
        updated_at: '2026-05-07T01:02:00.000Z',
        steps: [
          {
            id: STEP_ID,
            job_id: JOB_ID,
            name: 'Build',
            source_location: {start_line: 5, end_line: 5},
            status: 'running',
            type: 'run',
            config: {run: 'pnpm build'},
            error: null,
            position: 0,
            current_attempt: 1,
            created_at: '2026-05-07T01:01:00.000Z',
            updated_at: '2026-05-07T01:02:00.000Z',
            attempts: [
              {
                id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                step_id: STEP_ID,
                job_id: JOB_ID,
                attempt: 1,
                status: 'running',
                exit_code: null,
                output: null,
                error: null,
                gate_result: null,
                restart_reason: null,
                restart_result: null,
                started_at: '2026-05-07T01:01:30.000Z',
                finished_at: null,
              },
            ],
          },
        ],
      },
    ],
  };
}
