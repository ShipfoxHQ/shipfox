import type {RunDto, RunStatusDto} from '@shipfox/api-workflows-dto';
import {screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  test('restores every row after the filters are cleared', async () => {
    const user = userEvent.setup();
    renderListView([
      run('running', 'deploy-web'),
      run('failed', 'integration-tests'),
      run('succeeded', 'build-image'),
    ]);
    await user.type(await screen.findByLabelText('Search runs'), 'no-such-run');

    await user.click(await screen.findByRole('button', {name: 'Clear filters'}));

    expect(screen.getByText('deploy-web')).toBeInTheDocument();
    expect(screen.getByText('integration-tests')).toBeInTheDocument();
    expect(screen.getByText('build-image')).toBeInTheDocument();
    expect(screen.getByLabelText('Search runs')).toHaveValue('');
  });
});

function renderListView(runs: RunDto[]) {
  renderProjectPage(`/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs`, () => (
    <WorkflowRunsListView
      runs={runs}
      query={loadedQuery()}
      workspaceId={PROJECT_TEST_WID}
      projectId={PROJECT_ID}
    />
  ));
}

function run(status: RunStatusDto, name: string): RunDto {
  return {
    id: `run-${name}`,
    project_id: PROJECT_ID,
    definition_id: '55555555-5555-4555-8555-555555555555',
    name,
    status,
    trigger_source: 'github',
    trigger_event: 'push',
    trigger_payload: {},
    inputs: null,
    created_at: '2026-05-07T01:01:00.000Z',
    updated_at: '2026-05-07T01:02:00.000Z',
  };
}
