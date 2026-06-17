import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen, within} from '@testing-library/react';
import {jsonResponse, PROJECT_TEST_WID, renderProjectPage} from '#test/pages.js';
import {WorkflowRunPage} from './workflow-run-page.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const RUN_ID = '66666666-6666-4666-8666-666666666666';
const OTHER_RUN_ID = '77777777-7777-4777-8777-777777777777';
const DEFINITION_ID = '55555555-5555-4555-8555-555555555555';
const INLINE_MODE_HINT_RE = /Overview \| Source render inline/;
const CHECKOUT_ROW_RE = /checkout/;

describe('WorkflowRunPage', () => {
  test('renders a loading shell while the run detail loads', async () => {
    configureApiClient({fetchImpl: vi.fn(() => new Promise<Response>(() => undefined))});

    renderWorkflowRunPage(RUN_ID);

    expect(await screen.findByLabelText('Loading workflow run')).toBeInTheDocument();
    expect(screen.getByText(RUN_ID)).toBeInTheDocument();
  });

  test('renders an error state when the run detail cannot load', async () => {
    configureApiClient({
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}))),
    });

    renderWorkflowRunPage(RUN_ID);

    expect(await screen.findByText("Couldn't load workflow run")).toBeInTheDocument();
  });

  test('renders not found when the run detail returns 404', async () => {
    configureApiClient({fetchImpl: createWorkflowRunFetch()});

    // The fetch only serves RUN_ID; any other id 404s from the detail endpoint.
    renderWorkflowRunPage(OTHER_RUN_ID);

    expect(await screen.findByText('Run not found')).toBeInTheDocument();
    expect(
      screen.getByText(`This run does not exist or is no longer available: ${OTHER_RUN_ID}.`),
    ).toBeInTheDocument();
  });

  test('renders run identity, status, job/step counts, and the rail + center slots', async () => {
    configureApiClient({fetchImpl: createWorkflowRunFetch()});

    renderWorkflowRunPage(RUN_ID, {selectedJobId: 'job-build', selectedStepId: 'step-checkout'});

    expect(await screen.findByText('Deploy production')).toBeInTheDocument();
    expect(screen.getAllByText(RUN_ID)).not.toHaveLength(0);
    expect(screen.getAllByText('Running')).not.toHaveLength(0);
    // Real run-detail data flows into the live sections: the jobs visualization shows the
    // job by name and the step list shows the steps by name.
    expect(screen.getAllByText('build')).not.toHaveLength(0);
    expect(screen.getAllByText('checkout')).not.toHaveLength(0);
    expect(screen.getAllByText('test')).not.toHaveLength(0);

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

  test('renders the real source view inline when a step row switches to source mode', async () => {
    configureApiClient({fetchImpl: createWorkflowRunFetch()});

    renderWorkflowRunPage(RUN_ID);

    const checkoutRow = await screen.findByRole('button', {name: CHECKOUT_ROW_RE});
    fireEvent.click(checkoutRow);
    fireEvent.click(screen.getByRole('tab', {name: 'Source'}));

    // The source mode mounts the real WorkflowSourceView, not a placeholder note: the
    // snapshot content renders inside its labelled source-code region with line numbers.
    const sourceView = await screen.findByLabelText('Workflow source');
    const sourceCode = within(sourceView).getByLabelText('Workflow source code');
    expect(within(sourceCode).getByText('jobs:')).toBeInTheDocument();
    expect(within(sourceCode).getByText('1')).toBeInTheDocument();
    // The selected step's source_location drives the highlighted line range label.
    expect(within(sourceView).getByText('checkout')).toBeInTheDocument();
  });

  test('shows the source view empty state when the run has no source snapshot', async () => {
    configureApiClient({
      fetchImpl: createWorkflowRunFetch({detail: runDetailDto({sourceSnapshot: null})}),
    });

    renderWorkflowRunPage(RUN_ID);

    const checkoutRow = await screen.findByRole('button', {name: CHECKOUT_ROW_RE});
    fireEvent.click(checkoutRow);
    fireEvent.click(screen.getByRole('tab', {name: 'Source'}));

    expect(await screen.findByText('No source document')).toBeInTheDocument();
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

function createWorkflowRunFetch({detail = runDetailDto()}: {detail?: unknown} = {}) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(requestInputUrl(input));

    if (url.pathname === `/workflows/runs/${RUN_ID}`) {
      return Promise.resolve(jsonResponse(detail));
    }

    return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
  });
}

function requestInputUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return input.url;
  return String(input);
}

const SOURCE_YAML = [
  'name: deploy',
  'jobs:',
  '  build:',
  '    steps:',
  '      - run: pnpm test',
].join('\n');

// Mirrors GET /workflows/runs/:id: a run plus one job with two steps, carrying the source
// snapshot and per-step source locations the page feeds into the inline overview and source
// view.
function runDetailDto(
  overrides: Partial<{
    id: string;
    name: string;
    status: string;
    sourceSnapshot: {content: string; format: 'yaml'} | null;
  }> = {},
) {
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
    source_snapshot:
      overrides.sourceSnapshot === undefined
        ? {content: SOURCE_YAML, format: 'yaml'}
        : overrides.sourceSnapshot,
    created_at: '2026-05-07T01:01:00.000Z',
    updated_at: '2026-05-07T01:02:00.000Z',
    jobs: [
      {
        id: 'job-build',
        run_id: RUN_ID,
        name: 'build',
        status: 'succeeded',
        dependencies: [],
        position: 0,
        created_at: '2026-05-07T01:01:00.000Z',
        updated_at: '2026-05-07T01:02:00.000Z',
        steps: [
          stepDto({
            id: 'step-checkout',
            name: 'checkout',
            position: 0,
            sourceLocation: {
              start_line: 2,
              end_line: 4,
            },
          }),
          stepDto({
            id: 'step-test',
            name: 'test',
            position: 1,
            sourceLocation: {
              start_line: 5,
              end_line: 5,
            },
          }),
        ],
      },
    ],
  };
}

function stepDto({
  id,
  name,
  position,
  sourceLocation,
}: {
  id: string;
  name: string;
  position: number;
  sourceLocation: {start_line: number; end_line: number} | null;
}) {
  return {
    id,
    job_id: 'job-build',
    name,
    source_location: sourceLocation,
    status: 'succeeded',
    type: 'run',
    config: {run: 'pnpm test'},
    error: null,
    position,
    current_attempt: 1,
    created_at: '2026-05-07T01:01:00.000Z',
    updated_at: '2026-05-07T01:02:00.000Z',
    attempts: [],
  };
}
