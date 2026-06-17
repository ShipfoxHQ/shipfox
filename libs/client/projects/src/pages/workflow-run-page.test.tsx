import {configureApiClient} from '@shipfox/client-api';
import {screen} from '@testing-library/react';
import {jsonResponse, PROJECT_TEST_WID, renderProjectPage} from '#test/pages.js';
import {WorkflowRunPage} from './workflow-run-page.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const RUN_ID = '66666666-6666-4666-8666-666666666666';
const OTHER_RUN_ID = '77777777-7777-4777-8777-777777777777';
const DEFINITION_ID = '55555555-5555-4555-8555-555555555555';
const INLINE_MODE_HINT_RE = /Overview \| Source render inline/;

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

  test('renders run identity, status, and the rail + center section slots', async () => {
    configureApiClient({fetchImpl: createWorkflowRunFetch()});

    renderWorkflowRunPage(RUN_ID, {selectedJobId: 'job-build', selectedStepId: 'step-checkout'});

    expect(await screen.findByText('Deploy production')).toBeInTheDocument();
    expect(screen.getAllByText(RUN_ID)).not.toHaveLength(0);
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getAllByText('job-build')).not.toHaveLength(0);
    expect(screen.getAllByText('step-checkout')).not.toHaveLength(0);

    for (const section of ['Runs list', 'Run summary', 'Jobs visualization', 'Step list']) {
      expect(screen.getByRole('heading', {name: section})).toBeInTheDocument();
    }
  });

  test('keeps step overview/source inline in the step list, not a right-side inspector', async () => {
    configureApiClient({fetchImpl: createWorkflowRunFetch()});

    renderWorkflowRunPage(RUN_ID, {selectedStepId: 'step-checkout'});

    expect(await screen.findByText('Deploy production')).toBeInTheDocument();
    // The composition contract: overview/source are inline content modes of the step
    // list, never standalone inspector regions.
    expect(screen.getByText(INLINE_MODE_HINT_RE)).toBeInTheDocument();
    expect(screen.queryByRole('heading', {name: 'Step overview'})).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', {name: 'Source view'})).not.toBeInTheDocument();
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
