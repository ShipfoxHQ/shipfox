import {screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {WorkflowRun, WorkflowRunStatus} from '#core/workflow-run.js';
import {workflowRun} from '#test/fixtures/workflow-run.js';
import {PROJECT_TEST_WID, renderProjectPage} from '#test/pages.js';
import type {WorkflowRunsListQuery} from './types.js';
import {WorkflowRunsListView} from './workflow-runs-list-view.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';

function loadedQuery(): WorkflowRunsListQuery {
  return {
    isPending: false,
    isError: false,
    isFetching: false,
    data: {pages: [], pageParams: []},
    error: null,
    refetch: () => undefined,
  };
}

describe('WorkflowRunsListView', () => {
  test('narrows the list to the selected status filter', async () => {
    const user = userEvent.setup();
    renderListView([
      run('running', 'deploy-web'),
      run('failed', 'integration-tests'),
      run('succeeded', 'build-image'),
    ]);

    await user.click(await screen.findByRole('button', {name: 'Failed'}));

    expect(screen.getByText('integration-tests')).toBeInTheDocument();
    expect(screen.queryByText('deploy-web')).not.toBeInTheDocument();
    expect(screen.queryByText('build-image')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Failed'})).toHaveAttribute('aria-pressed', 'true');
  });

  test('the Running filter keeps in-progress pending runs alongside running ones', async () => {
    const user = userEvent.setup();
    renderListView([
      run('running', 'deploy-web'),
      run('pending', 'queued-build'),
      run('succeeded', 'build-image'),
    ]);

    await user.click(await screen.findByRole('button', {name: 'Running'}));

    expect(screen.getByText('deploy-web')).toBeInTheDocument();
    expect(screen.getByText('queued-build')).toBeInTheDocument();
    expect(screen.queryByText('build-image')).not.toBeInTheDocument();
  });

  test('renders optimistic temp runs without a navigable link', async () => {
    renderListView([run('pending', 'queued-build', 'temp-1234'), run('running', 'deploy-web')]);

    // The canonical run is a link to its detail page; the optimistic temp run is shown but
    // not yet navigable (its detail page does not exist until the canonical row replaces it).
    const links = await screen.findAllByRole('link');
    expect(links.some((link) => link.textContent?.includes('deploy-web'))).toBe(true);
    expect(links.some((link) => link.textContent?.includes('queued-build'))).toBe(false);
    expect(screen.getByText('queued-build')).toBeInTheDocument();
  });

  test('restores every row after the filters are cleared', async () => {
    const user = userEvent.setup();
    renderListView([
      run('running', 'deploy-web'),
      run('failed', 'integration-tests'),
      run('succeeded', 'build-image'),
    ]);
    await user.type(await screen.findByLabelText('Search runs'), 'no-such-run');

    expect(screen.getByText('No matching runs')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', {name: 'Clear filters'}));

    expect(screen.getByText('deploy-web')).toBeInTheDocument();
    expect(screen.getByText('integration-tests')).toBeInTheDocument();
    expect(screen.getByText('build-image')).toBeInTheDocument();
    expect(screen.getByLabelText('Search runs')).toHaveValue('');
  });
});

function renderListView(runs: WorkflowRun[]) {
  renderProjectPage(`/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs`, () => (
    <WorkflowRunsListView
      runs={runs}
      query={loadedQuery()}
      workspaceId={PROJECT_TEST_WID}
      projectId={PROJECT_ID}
    />
  ));
}

function run(status: WorkflowRunStatus, name: string, id = `run-${name}`): WorkflowRun {
  return workflowRun({
    id,
    project_id: PROJECT_ID,
    definition_id: '55555555-5555-4555-8555-555555555555',
    name,
    status,
    trigger_source: 'github',
    trigger_event: 'push',
    created_at: '2026-05-07T01:01:00.000Z',
    updated_at: '2026-05-07T01:02:00.000Z',
  });
}
