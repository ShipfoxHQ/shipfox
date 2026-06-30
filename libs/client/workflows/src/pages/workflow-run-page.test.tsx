import type {RunDetailResponseDto, RunResponseDto} from '@shipfox/api-workflows-dto';
import {configureApiClient} from '@shipfox/client-api';
import {act, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {inlineLogBody, outputLine} from '#test/fixtures/logs.js';
import {
  workflowJobDto,
  workflowRunDetailDto,
  workflowRunDto,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {jsonResponse, PROJECT_TEST_WID, renderProjectPage} from '#test/pages.js';
import {WorkflowRunPage} from './workflow-run-page.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const DEFINITION_ID = '55555555-5555-4555-8555-555555555555';
const RUN_ID = '66666666-6666-4666-8666-666666666666';
const SECOND_RUN_ID = '66666666-6666-4666-8666-000000000002';
const BUILD_JOB_ID = '77777777-7777-4777-8777-777777777777';
const BUILD_STEP_ID = '99999999-9999-4999-8999-000000000000';
const BUILD_ATTEMPT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000000';
const DEPLOY_JOB_ID = '88888888-8888-4888-8888-888888888888';
const DEPLOY_STEP_ID = '99999999-9999-4999-8999-999999999999';
const DEPLOY_ATTEMPT_ONE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const DEPLOY_ATTEMPT_TWO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
const SMOKE_WEB_RE = /smoke-web/u;
const RUN_DETAIL_PATH_RE = /^\/workflows\/runs\/([^/]+)$/u;
const RUN_OVERRIDES = {
  id: RUN_ID,
  project_id: PROJECT_ID,
  definition_id: DEFINITION_ID,
  trigger_payload: {source: 'manual', event: 'fire'},
  created_at: '2026-05-07T01:01:00.000Z',
  updated_at: '2026-05-07T01:02:00.000Z',
} satisfies Partial<RunResponseDto>;
const SECOND_RUN_OVERRIDES = {
  ...RUN_OVERRIDES,
  id: SECOND_RUN_ID,
  name: 'smoke-web',
} satisfies Partial<RunResponseDto>;

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

    const {router} = renderRunsPath(
      `?job=${DEPLOY_JOB_ID}&step=${DEPLOY_STEP_ID}&attempt=${DEPLOY_ATTEMPT_TWO_ID}`,
    );

    // Landing on /runs with runs present redirects to the newest run, so its row becomes the
    // selected (current) row in the rail even though the opened URL carried no run id.
    const selectedRow = await screen.findByRole('link', {current: 'page'});
    expect(selectedRow).toHaveTextContent('deploy-web');
    expect(currentSearch(router).job).toBeUndefined();
    expect(currentSearch(router).step).toBeUndefined();
    expect(currentSearch(router).attempt).toBeUndefined();
  });

  test('shows the first-time-use surface when the project has no runs', async () => {
    configureApiClient({fetchImpl: createEmptyRunsFetch()});

    renderRunsPath();

    expect(await screen.findByText('No workflow runs yet')).toBeInTheDocument();
    // The rail and the perpetual detail skeleton give way to the onboarding surface entirely.
    expect(screen.queryByLabelText('Workflow runs')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Loading workflow run')).not.toBeInTheDocument();
  });

  test('restores a deep-linked job and exact attempt after data loads', async () => {
    configureApiClient({fetchImpl: createRunDetailFetch()});

    renderRunPath(`?job=${BUILD_JOB_ID}&step=${DEPLOY_STEP_ID}&attempt=${DEPLOY_ATTEMPT_TWO_ID}`);

    const deployJob = await screen.findByRole('button', {name: 'deploy, Running'});
    const deployAttempt = await screen.findByRole('button', {
      name: 'deploy, Running, attempt 2',
    });

    expect(deployJob).toHaveAttribute('aria-pressed', 'true');
    expect(deployAttempt).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('attempt two log')).toBeInTheDocument();
  });

  test('selecting a job writes job search state and clears stale step state', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: createRunDetailFetch()});
    const {router} = renderRunPath(`?step=${DEPLOY_STEP_ID}&attempt=${DEPLOY_ATTEMPT_TWO_ID}`);

    await user.click(await screen.findByRole('button', {name: 'build, Succeeded'}));

    await waitFor(() => {
      expect(currentSearch(router)).toMatchObject({job: BUILD_JOB_ID});
    });
    expect(currentSearch(router).step).toBeUndefined();
    expect(currentSearch(router).attempt).toBeUndefined();
    expect(screen.getByRole('button', {name: 'checkout, Succeeded, attempt 1'})).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  test('selecting an attempt writes job, step, and attempt search state', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: createRunDetailFetch()});
    const {router} = renderRunPath(`?job=${DEPLOY_JOB_ID}`);

    await user.click(await screen.findByRole('button', {name: 'deploy, Running, attempt 2'}));

    await waitFor(() => {
      expect(currentSearch(router)).toMatchObject({
        job: DEPLOY_JOB_ID,
        step: DEPLOY_STEP_ID,
        attempt: DEPLOY_ATTEMPT_TWO_ID,
      });
    });
  });

  test('collapsing an attempt removes step and attempt while preserving job', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: createRunDetailFetch()});
    const {router} = renderRunPath(`?step=${DEPLOY_STEP_ID}&attempt=${DEPLOY_ATTEMPT_TWO_ID}`);

    const deployAttempt = await screen.findByRole('button', {
      name: 'deploy, Running, attempt 2',
    });
    await user.click(deployAttempt);

    await waitFor(() => {
      expect(currentSearch(router)).toMatchObject({job: DEPLOY_JOB_ID});
    });
    expect(currentSearch(router).step).toBeUndefined();
    expect(currentSearch(router).attempt).toBeUndefined();
    expect(deployAttempt).toHaveAttribute('aria-expanded', 'false');
  });

  test('back and forward navigation restores prior selections', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: createRunDetailFetch()});
    const {router} = renderRunPath(`?job=${DEPLOY_JOB_ID}`);

    await user.click(await screen.findByRole('button', {name: 'deploy, Running, attempt 2'}));
    await waitFor(() => {
      expect(currentSearch(router).attempt).toBe(DEPLOY_ATTEMPT_TWO_ID);
    });

    await act(() => {
      router.history.back();
    });
    await waitFor(() => {
      expect(currentSearch(router)).toMatchObject({job: DEPLOY_JOB_ID});
    });
    expect(currentSearch(router).step).toBeUndefined();
    expect(currentSearch(router).attempt).toBeUndefined();
    expect(screen.getByRole('button', {name: 'deploy, Running, attempt 2'})).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    await act(() => {
      router.history.forward();
    });
    await waitFor(() => {
      expect(currentSearch(router).attempt).toBe(DEPLOY_ATTEMPT_TWO_ID);
    });
    expect(screen.getByRole('button', {name: 'deploy, Running, attempt 2'})).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  test('run rail links clear job, step, and attempt when switching runs', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: createRunDetailFetch({
        runs: [workflowRunDto(RUN_OVERRIDES), workflowRunDto(SECOND_RUN_OVERRIDES)],
        details: {
          [RUN_ID]: defaultRunDetailDto(),
          [SECOND_RUN_ID]: workflowRunDetailDto({...SECOND_RUN_OVERRIDES, jobs: []}),
        },
      }),
    });
    const {router} = renderRunPath(`?step=${DEPLOY_STEP_ID}&attempt=${DEPLOY_ATTEMPT_TWO_ID}`);

    await user.click(await screen.findByRole('link', {name: SMOKE_WEB_RE}));

    await waitFor(() => {
      expect(router.state.location.pathname).toContain(SECOND_RUN_ID);
    });
    expect(currentSearch(router).job).toBeUndefined();
    expect(currentSearch(router).step).toBeUndefined();
    expect(currentSearch(router).attempt).toBeUndefined();
  });
});

function renderRunsPath(search = '') {
  return renderProjectPage(
    `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs${search}`,
    ({runId}) => (
      <WorkflowRunPage workspaceId={PROJECT_TEST_WID} projectId={PROJECT_ID} runId={runId} />
    ),
  );
}

function renderRunPath(search = '') {
  return renderProjectPage(
    `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs/${RUN_ID}${search}`,
    ({runId}) => (
      <WorkflowRunPage workspaceId={PROJECT_TEST_WID} projectId={PROJECT_ID} runId={runId} />
    ),
  );
}

function createRunsListFetch() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(requestInputUrl(input));

    if (url.pathname === '/workflows/runs') {
      return Promise.resolve(
        jsonResponse({
          runs: [workflowRunDto(RUN_OVERRIDES)],
          next_cursor: null,
          filtered_total_count: 1,
        }),
      );
    }
    if (url.pathname === `/workflows/runs/${RUN_ID}`) {
      return Promise.resolve(jsonResponse(workflowRunDetailDto({...RUN_OVERRIDES, jobs: []})));
    }

    return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
  });
}

function createRunDetailFetch({
  runs = [workflowRunDto(RUN_OVERRIDES)],
  details = {[RUN_ID]: defaultRunDetailDto()},
}: {
  runs?: RunResponseDto[];
  details?: Record<string, RunDetailResponseDto>;
} = {}) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(requestInputUrl(input));

    if (url.pathname === '/workflows/runs') {
      return Promise.resolve(
        jsonResponse({runs, next_cursor: null, filtered_total_count: runs.length}),
      );
    }

    const runMatch = url.pathname.match(RUN_DETAIL_PATH_RE);
    if (runMatch?.[1] && details[runMatch[1]]) {
      return Promise.resolve(jsonResponse(details[runMatch[1]]));
    }

    if (url.pathname === `/steps/${DEPLOY_STEP_ID}/attempts/1/logs`) {
      return Promise.resolve(jsonResponse(inlineLogBody(outputLine('attempt one log\n'), 1)));
    }
    if (url.pathname === `/steps/${DEPLOY_STEP_ID}/attempts/2/logs`) {
      return Promise.resolve(jsonResponse(inlineLogBody(outputLine('attempt two log\n'), 1)));
    }
    if (url.pathname === `/steps/${BUILD_STEP_ID}/attempts/1/logs`) {
      return Promise.resolve(jsonResponse(inlineLogBody(outputLine('build log\n'), 1)));
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

function defaultRunDetailDto(overrides: Partial<RunDetailResponseDto> = {}): RunDetailResponseDto {
  return workflowRunDetailDto({
    ...RUN_OVERRIDES,
    jobs: [
      workflowJobDto({
        id: BUILD_JOB_ID,
        run_id: RUN_ID,
        name: 'build',
        status: 'succeeded',
        steps: [
          workflowStepDto({
            id: BUILD_STEP_ID,
            name: 'checkout',
            display_name: 'checkout',
            status: 'succeeded',
            current_attempt: 1,
            attempts: [
              workflowStepAttemptDto({
                id: BUILD_ATTEMPT_ID,
                step_id: BUILD_STEP_ID,
                status: 'succeeded',
              }),
            ],
          }),
        ],
      }),
      workflowJobDto({
        id: DEPLOY_JOB_ID,
        run_id: RUN_ID,
        name: 'deploy',
        status: 'running',
        position: 1,
        dependencies: ['build'],
        steps: [
          workflowStepDto({
            id: DEPLOY_STEP_ID,
            name: 'deploy',
            display_name: 'deploy',
            status: 'running',
            current_attempt: 2,
            attempts: [
              workflowStepAttemptDto({
                id: DEPLOY_ATTEMPT_ONE_ID,
                step_id: DEPLOY_STEP_ID,
                attempt: 1,
                execution_order: 1,
                status: 'failed',
                exit_code: 1,
              }),
              workflowStepAttemptDto({
                id: DEPLOY_ATTEMPT_TWO_ID,
                step_id: DEPLOY_STEP_ID,
                attempt: 2,
                execution_order: 2,
                status: 'running',
                exit_code: null,
                finished_at: null,
              }),
            ],
          }),
        ],
      }),
    ],
    ...overrides,
  });
}

function currentSearch({state}: ReturnType<typeof renderRunPath>['router']) {
  return state.location.search as Record<string, unknown>;
}
