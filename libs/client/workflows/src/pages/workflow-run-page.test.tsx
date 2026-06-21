import {configureApiClient} from '@shipfox/client-api';
import {screen} from '@testing-library/react';
import {jsonResponse, PROJECT_TEST_WID, renderProjectPage} from '#test/pages.js';
import {WorkflowRunPage} from './workflow-run-page.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const RUN_ID = '66666666-6666-4666-8666-666666666666';

describe('WorkflowRunPage', () => {
  test('keeps the runs list mounted and only skeletons the run view until a run is selected', async () => {
    configureApiClient({fetchImpl: vi.fn(() => new Promise<Response>(() => undefined))});

    renderRunsPath();

    // The run view has nothing to show until a run is selected, so it skeletons...
    expect(await screen.findByLabelText('Loading workflow run')).toBeInTheDocument();
    // ...but the runs list itself stays mounted; it is never replaced by a page skeleton.
    expect(screen.getByLabelText('Workflow runs')).toBeInTheDocument();
  });

  test('redirects to the most recent run when opened without a run id', async () => {
    configureApiClient({fetchImpl: createRunsListFetch()});

    renderRunsPath();

    // Landing on /runs with runs present redirects to the newest run, so its row becomes the
    // selected (current) row in the rail even though the opened URL carried no run id.
    const selectedRow = await screen.findByRole('link', {current: 'page'});
    expect(selectedRow).toHaveTextContent('deploy-web');
  });

  test('shows the first-time-use surface when the project has no runs', async () => {
    configureApiClient({fetchImpl: createEmptyRunsFetch()});

    renderRunsPath();

    expect(await screen.findByText('No workflow runs yet')).toBeInTheDocument();
    // The rail and the perpetual detail skeleton give way to the onboarding surface entirely.
    expect(screen.queryByLabelText('Workflow runs')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Loading workflow run')).not.toBeInTheDocument();
  });
});

function renderRunsPath() {
  renderProjectPage(`/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs`, ({runId}) => (
    <WorkflowRunPage workspaceId={PROJECT_TEST_WID} projectId={PROJECT_ID} runId={runId} />
  ));
}

function createRunsListFetch() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(requestInputUrl(input));

    if (url.pathname === '/workflows/runs') {
      return Promise.resolve(
        jsonResponse({runs: [runDto()], next_cursor: null, filtered_total_count: 1}),
      );
    }
    if (url.pathname === `/workflows/runs/${RUN_ID}`) {
      return Promise.resolve(jsonResponse(runDto()));
    }

    return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
  });
}

function createEmptyRunsFetch() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(requestInputUrl(input));

    if (url.pathname === '/workflows/runs') {
      return Promise.resolve(jsonResponse({runs: [], next_cursor: null, filtered_total_count: 0}));
    }

    return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
  });
}

function requestInputUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return input.url;
  return String(input);
}

// The newest run the list returns; the page should redirect onto it when opened at /runs.
function runDto() {
  return {
    id: RUN_ID,
    project_id: PROJECT_ID,
    definition_id: '55555555-5555-4555-8555-555555555555',
    name: 'deploy-web',
    status: 'running',
    trigger_source: 'manual',
    trigger_event: 'fire',
    trigger_payload: {source: 'manual', event: 'fire'},
    inputs: null,
    created_at: '2026-05-07T01:01:00.000Z',
    updated_at: '2026-05-07T01:02:00.000Z',
  };
}
