import type {JobStatusDto} from '@shipfox/api-workflows-dto';
import {configureApiClient} from '@shipfox/client-api';
import {screen} from '@testing-library/react';
import {jsonResponse, PROJECT_TEST_WID, renderProjectPage} from '#test/pages.js';
import {WorkflowRunView} from './workflow-run-view.js';

const RUN_ID = '66666666-6666-4666-8666-666666666666';

describe('WorkflowRunView', () => {
  test('renders the jobs graph when a run loads', async () => {
    configureApiClient({
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse(runDetailDto()))),
    });

    renderView();

    expect(await screen.findByRole('region', {name: 'Jobs graph'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'build, Succeeded'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'deploy, Running, needs build'})).toBeInTheDocument();
  });

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

function runDetailDto() {
  return {
    id: RUN_ID,
    project_id: '44444444-4444-4444-8444-444444444444',
    definition_id: '55555555-5555-4555-8555-555555555555',
    name: 'deploy-web',
    status: 'running',
    trigger_source: 'manual',
    trigger_event: 'fire',
    trigger_payload: {},
    inputs: null,
    created_at: '2026-05-07T01:01:00.000Z',
    updated_at: '2026-05-07T01:02:00.000Z',
    jobs: [
      jobDto({id: '77777777-7777-4777-8777-777777777777', name: 'build', status: 'succeeded'}),
      jobDto({
        id: '88888888-8888-4888-8888-888888888888',
        name: 'deploy',
        status: 'running',
        position: 1,
        dependencies: ['build'],
      }),
    ],
  };
}

function jobDto({
  id,
  name,
  status,
  position = 0,
  dependencies = [],
}: {
  id: string;
  name: string;
  status: JobStatusDto;
  position?: number;
  dependencies?: string[];
}) {
  return {
    id,
    run_id: RUN_ID,
    name,
    status,
    dependencies,
    position,
    created_at: '2026-05-07T01:01:00.000Z',
    updated_at: '2026-05-07T01:02:00.000Z',
    steps: [],
  };
}
