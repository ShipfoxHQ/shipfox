import {configureApiClient} from '@shipfox/client-api';
import {screen} from '@testing-library/react';
import {jsonResponse, PROJECT_TEST_WID, renderProjectPage} from '#test/pages.js';
import {WorkflowRunView} from './workflow-run-view.js';

const RUN_ID = '66666666-6666-4666-8666-666666666666';

describe('WorkflowRunView', () => {
  test('shows the not-found surface when the run 404s', async () => {
    configureApiClient({
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}))),
    });

    renderView();

    expect(await screen.findByText('Run not found')).toBeInTheDocument();
  });

  test('shows the load-error placeholder when the run fails to load', async () => {
    configureApiClient({
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}))),
    });

    renderView();

    expect(
      await screen.findByRole('button', {name: 'Retry loading workflow run'}),
    ).toBeInTheDocument();
  });
});

function renderView() {
  renderProjectPage(`/workspaces/${PROJECT_TEST_WID}/projects/x/runs/${RUN_ID}`, () => (
    <WorkflowRunView runId={RUN_ID} />
  ));
}
