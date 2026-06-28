import type {RunDetailResponseDto} from '@shipfox/api-workflows-dto';
import {configureApiClient} from '@shipfox/client-api';
import {toast} from '@shipfox/react-ui';
import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {inlineLogBody, outputLine} from '#test/fixtures/logs.js';
import {
  runAttemptsResponseDto,
  workflowJobDto,
  workflowRunAttemptDto,
  workflowRunDetailDto,
  workflowRunDto,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {jsonResponse, PROJECT_TEST_WID, renderProjectPage} from '#test/pages.js';
import {WorkflowRunView} from './workflow-run-view.js';

const RUN_ID = '66666666-6666-4666-8666-666666666666';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const DEFINITION_ID = '55555555-5555-4555-8555-555555555555';
const BUILD_JOB_ID = '77777777-7777-4777-8777-777777777777';
const DEPLOY_JOB_ID = '88888888-8888-4888-8888-888888888888';
const CHECKOUT_STEP_ID = '99999999-9999-4999-8999-999999999999';
const CHECKOUT_ATTEMPT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RERUN_BUTTON_NAME = /^Re-run/;
const ATTEMPT_2_PATTERN = /Attempt 2/;

describe('WorkflowRunView', () => {
  test('renders the run summary, jobs graph, and selected job step attempts when a run loads', async () => {
    configureApiClient({
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse(workflowRunViewDetailDto()))),
    });

    renderView();

    const summary = await screen.findByRole('region', {name: 'deploy-web'});

    expect(within(summary).getByRole('heading', {name: 'deploy-web'})).toBeInTheDocument();
    expect(within(summary).getAllByText('Running')).not.toHaveLength(0);
    expect(within(summary).getByText('fire')).toBeInTheDocument();
    expect(within(summary).getByRole('button', {name: `Copy run id ${RUN_ID}`})).toHaveTextContent(
      '66666666',
    );
    expect(await screen.findByRole('region', {name: 'Workflow jobs'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'build, Succeeded'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'deploy, Running'})).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'build'})).toBeInTheDocument();
    expect(
      screen.getByRole('button', {name: 'checkout, Succeeded, attempt 1'}),
    ).toBeInTheDocument();
  });

  test('renders active step attempt logs inline when the selected job is running', async () => {
    const stepId = '99999999-9999-4999-8999-000000000001';
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.pathname === `/steps/${stepId}/attempts/1/logs`) {
        return Promise.resolve(jsonResponse(inlineLogBody(outputLine('live output\n'), 1)));
      }
      return Promise.resolve(
        jsonResponse(
          workflowRunViewDetailDto({
            jobs: [
              workflowJobDto({
                id: BUILD_JOB_ID,
                run_id: RUN_ID,
                name: 'build',
                status: 'running',
                steps: [
                  workflowStepDto({
                    id: stepId,
                    job_id: BUILD_JOB_ID,
                    name: 'test',
                    display_name: 'test',
                    status: 'running',
                    attempts: [
                      workflowStepAttemptDto({
                        id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
                        step_id: stepId,
                        job_id: BUILD_JOB_ID,
                        status: 'running',
                        exit_code: null,
                        finished_at: null,
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ),
      );
    });
    configureApiClient({fetchImpl: fetchImpl as typeof fetch});

    renderView();

    expect(await screen.findByText('live output')).toBeInTheDocument();
    const logRequest = fetchImpl.mock.calls
      .map((call) => new URL((call[0] as Request).url))
      .find((url) => url.pathname === `/steps/${stepId}/attempts/1/logs`);
    expect(logRequest?.searchParams.get('cursor')).toBe('0');
  });

  test('renders skipped zero-attempt jobs as skipped instead of missing attempts', async () => {
    configureApiClient({
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            workflowRunViewDetailDto({
              jobs: [
                workflowJobDto({
                  id: DEPLOY_JOB_ID,
                  run_id: RUN_ID,
                  name: 'deploy',
                  status: 'skipped',
                  status_reason: 'dependency_not_completed',
                  steps: [],
                }),
              ],
            }),
          ),
        ),
      ),
    });

    renderView();

    expect(await screen.findByText('This job was skipped')).toBeInTheDocument();
    expect(
      screen.getByText('A required job did not complete, so this job was skipped.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('No step attempts yet')).not.toBeInTheDocument();
  });

  test('renders cancelled zero-attempt jobs separately from skipped jobs', async () => {
    configureApiClient({
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            workflowRunViewDetailDto({
              jobs: [
                workflowJobDto({
                  id: DEPLOY_JOB_ID,
                  run_id: RUN_ID,
                  name: 'deploy',
                  status: 'cancelled',
                  steps: [],
                }),
              ],
            }),
          ),
        ),
      ),
    });

    renderView();

    expect(await screen.findByText('Cancelled before start')).toBeInTheDocument();
    expect(screen.getByText('This job was cancelled before any step started.')).toBeInTheDocument();
    expect(screen.queryByText('This job was skipped')).not.toBeInTheDocument();
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

  test('opens and closes workflow source without resetting the selected job', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            workflowRunViewDetailDto({
              source_snapshot: {
                format: 'yaml',
                content: 'jobs:\n  build:\n    steps:\n      - run: pnpm test',
              },
            }),
          ),
        ),
      ),
    });

    renderView();

    const deployNode = await screen.findByRole('button', {name: 'deploy, Running'});
    await user.click(deployNode);
    expect(deployNode).toHaveAttribute('aria-pressed', 'true');

    const sourceButton = screen.getByRole('button', {name: 'View source'});
    const panelId = sourceButton.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    expect(sourceButton).toHaveAttribute('aria-expanded', 'false');

    await user.click(sourceButton);

    const sourcePanel = screen.getByRole('dialog', {name: 'Workflow source'});
    expect(sourceButton).toHaveAttribute('aria-expanded', 'true');
    expect(sourcePanel).toHaveAttribute('id', panelId);
    expect(sourcePanel).toHaveTextContent('pnpm test');

    await user.click(screen.getByRole('button', {name: 'Close source'}));

    await waitFor(() => expect(sourceButton).toHaveFocus());
    expect(sourceButton).toHaveAttribute('aria-expanded', 'false');
    expect(deployNode).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', {name: 'deploy'})).toBeInTheDocument();
  });

  test('highlights selected step source lines when the source panel opens', async () => {
    const user = userEvent.setup();
    const stepId = '99999999-9999-4999-8999-000000000003';
    configureApiClient({
      fetchImpl: vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            workflowRunViewDetailDto({
              source_snapshot: {
                format: 'yaml',
                content: 'jobs:\n  deploy:\n    steps:\n      - run: ship',
              },
              jobs: [
                workflowJobDto({
                  id: DEPLOY_JOB_ID,
                  run_id: RUN_ID,
                  name: 'deploy',
                  status: 'running',
                  steps: [
                    workflowStepDto({
                      id: stepId,
                      job_id: DEPLOY_JOB_ID,
                      name: 'deploy',
                      display_name: 'deploy',
                      source_location: {start_line: 2, end_line: 3},
                      status: 'running',
                    }),
                  ],
                }),
              ],
            }),
          ),
        ),
      ),
    });

    renderView({selection: {stepId}});
    await user.click(await screen.findByRole('button', {name: 'View source'}));

    await screen.findByRole('dialog', {name: 'Workflow source'});
    const highlightedLines = document.body.querySelectorAll('.line.highlighted-line');
    expect(highlightedLines).toHaveLength(2);
    expect(highlightedLines[0]).toHaveTextContent('deploy:');
    expect(highlightedLines[1]).toHaveTextContent('steps:');
  });

  test('does not render a source control when the run has no source snapshot', async () => {
    configureApiClient({
      fetchImpl: vi.fn(() =>
        Promise.resolve(jsonResponse(workflowRunViewDetailDto({source_snapshot: null}))),
      ),
    });

    renderView();

    await screen.findByRole('region', {name: 'deploy-web'});

    expect(screen.queryByRole('button', {name: 'View source'})).not.toBeInTheDocument();
  });

  test('re-runs all jobs from a succeeded run and navigates to the new run', async () => {
    const user = userEvent.setup();
    const rerunId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const successSpy = vi.spyOn(toast, 'success').mockImplementation(() => 'toast-id');
    const postBodies: unknown[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      const url = requestUrl(input);
      if (request.method === 'POST' && url.pathname === `/workflows/runs/${RUN_ID}/rerun`) {
        postBodies.push(await request.clone().json());
        return jsonResponse(workflowRunDto({id: rerunId, status: 'pending'}));
      }
      return jsonResponse(
        workflowRunViewDetailDto({
          status: 'succeeded',
          jobs: [
            workflowJobDto({
              id: BUILD_JOB_ID,
              run_id: RUN_ID,
              name: 'build',
              status: 'succeeded',
            }),
          ],
        }),
      );
    });
    configureApiClient({fetchImpl: fetchImpl as typeof fetch});

    const {router} = renderView();
    await user.click(await screen.findByRole('button', {name: 'Re-run workflow'}));

    const postRequest = await findRequest(fetchImpl, 'POST', `/workflows/runs/${RUN_ID}/rerun`);
    expect(postRequest).toBeDefined();
    expect(postBodies).toEqual([{mode: 'all'}]);
    expect(successSpy).toHaveBeenCalledWith('Re-run started');
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs/${rerunId}`,
      ),
    );
  });

  test('re-runs failed jobs from the dropdown', async () => {
    const user = userEvent.setup();
    const postBodies: unknown[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      const url = requestUrl(input);
      if (request.method === 'POST' && url.pathname === `/workflows/runs/${RUN_ID}/rerun`) {
        postBodies.push(await request.clone().json());
        return jsonResponse(workflowRunDto({id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}));
      }
      return jsonResponse(
        workflowRunViewDetailDto({
          status: 'failed',
          jobs: [
            workflowJobDto({
              id: BUILD_JOB_ID,
              run_id: RUN_ID,
              name: 'build',
              status: 'failed',
            }),
            workflowJobDto({
              id: DEPLOY_JOB_ID,
              run_id: RUN_ID,
              name: 'deploy',
              status: 'cancelled',
              position: 1,
            }),
          ],
        }),
      );
    });
    configureApiClient({fetchImpl: fetchImpl as typeof fetch});

    renderView();
    await user.click(await screen.findByRole('button', {name: 'Re-run jobs'}));
    await user.click(await screen.findByRole('menuitem', {name: 'Re-run failed jobs'}));

    const postRequest = await findRequest(fetchImpl, 'POST', `/workflows/runs/${RUN_ID}/rerun`);
    expect(postRequest).toBeDefined();
    expect(postBodies).toEqual([{mode: 'failed'}]);
  });

  test('shows an error toast when rerun creation fails', async () => {
    const user = userEvent.setup();
    const errorSpy = vi.spyOn(toast, 'error').mockImplementation(() => 'toast-id');
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      const url = requestUrl(input);
      if (request.method === 'POST' && url.pathname === `/workflows/runs/${RUN_ID}/rerun`) {
        return Promise.resolve(
          jsonResponse({code: 'no-failed-jobs', message: 'Run has no failed jobs'}, {status: 409}),
        );
      }
      return Promise.resolve(jsonResponse(workflowRunViewDetailDto({status: 'succeeded'})));
    });
    configureApiClient({fetchImpl: fetchImpl as typeof fetch});

    renderView();
    await user.click(await screen.findByRole('button', {name: 'Re-run workflow'}));

    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('Run has no failed jobs'));
  });

  test('selects another run attempt and clears job selection search', async () => {
    const user = userEvent.setup();
    const secondRunId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.pathname === `/workflows/runs/${RUN_ID}/attempts`) {
        return Promise.resolve(
          jsonResponse(
            runAttemptsResponseDto({
              attempts: [
                workflowRunAttemptDto({
                  id: RUN_ID,
                  attempt: 1,
                  status: 'succeeded',
                  created_at: '2026-05-07T01:01:00.000Z',
                }),
                workflowRunAttemptDto({
                  id: secondRunId,
                  attempt: 2,
                  status: 'running',
                  created_at: '2026-05-07T01:02:00.000Z',
                  rerun_mode: 'all',
                }),
              ],
            }),
          ),
        );
      }
      return Promise.resolve(
        jsonResponse(
          workflowRunViewDetailDto({
            root_run_id: RUN_ID,
            attempt: 1,
            latest_attempt: 2,
          }),
        ),
      );
    });
    configureApiClient({fetchImpl: fetchImpl as typeof fetch});

    const {router} = renderProjectPage(
      `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs/${RUN_ID}?job=${BUILD_JOB_ID}&step=${CHECKOUT_STEP_ID}&attempt=${CHECKOUT_ATTEMPT_ID}`,
      () => (
        <WorkflowRunView workspaceId={PROJECT_TEST_WID} projectId={PROJECT_ID} runId={RUN_ID} />
      ),
    );

    await user.click(await screen.findByRole('button', {name: 'Switch attempt, currently 1 of 2'}));
    await user.click(await screen.findByRole('menuitem', {name: ATTEMPT_2_PATTERN}));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/workspaces/${PROJECT_TEST_WID}/projects/${PROJECT_ID}/runs/${secondRunId}`,
      ),
    );
    expect(router.state.location.search).toEqual({});
  });

  test('does not render rerun controls for non-terminal runs', async () => {
    configureApiClient({
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse(workflowRunViewDetailDto()))),
    });

    renderView();

    await screen.findByRole('region', {name: 'deploy-web'});
    expect(screen.queryByRole('button', {name: RERUN_BUTTON_NAME})).not.toBeInTheDocument();
  });

  test('renders carried-over steps without requesting attempt logs', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          workflowRunViewDetailDto({
            status: 'succeeded',
            jobs: [
              workflowJobDto({
                id: BUILD_JOB_ID,
                run_id: RUN_ID,
                name: 'build',
                status: 'succeeded',
                carried_over: true,
                steps: [
                  workflowStepDto({
                    id: CHECKOUT_STEP_ID,
                    job_id: BUILD_JOB_ID,
                    name: 'checkout',
                    display_name: 'checkout',
                    status: 'succeeded',
                    attempts: [],
                  }),
                ],
              }),
            ],
          }),
        ),
      ),
    );
    configureApiClient({fetchImpl: fetchImpl as typeof fetch});

    renderView();
    expect(
      await screen.findByRole('button', {name: 'build, Succeeded, reused'}),
    ).toBeInTheDocument();
    expect(screen.getAllByText('reused')).toHaveLength(2);
    await user.click(screen.getByRole('button', {name: 'checkout, Succeeded, attempt 1'}));

    expect(await screen.findByText('Not executed in this run.')).toBeInTheDocument();
    expect(
      mockRequests(fetchImpl).some((request) => requestUrl(request).pathname.includes('/logs')),
    ).toBe(false);
  });
});

function renderView(props: Partial<Parameters<typeof WorkflowRunView>[0]> = {}) {
  return renderProjectPage(`/workspaces/${PROJECT_TEST_WID}/projects/x/runs/${RUN_ID}`, () => (
    <WorkflowRunView
      workspaceId={PROJECT_TEST_WID}
      projectId={PROJECT_ID}
      runId={RUN_ID}
      {...props}
    />
  ));
}

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(String(input));
}

async function findRequest(
  fetchImpl: ReturnType<typeof vi.fn>,
  method: string,
  pathname: string,
): Promise<Request> {
  await waitFor(() => {
    const match = mockRequests(fetchImpl).find(
      (request) => request.method === method && requestUrl(request).pathname === pathname,
    );
    expect(match).toBeDefined();
  });
  const match = mockRequests(fetchImpl).find(
    (request) => request.method === method && requestUrl(request).pathname === pathname,
  );
  if (!match) throw new Error(`Missing ${method} ${pathname}`);
  return match;
}

function mockRequests(fetchImpl: ReturnType<typeof vi.fn>): Request[] {
  return (fetchImpl.mock.calls as unknown[][])
    .map((call) => call[0])
    .filter((input): input is Request => input instanceof Request);
}

function workflowRunViewDetailDto(
  overrides: Partial<RunDetailResponseDto> = {},
): RunDetailResponseDto {
  return workflowRunDetailDto({
    id: RUN_ID,
    project_id: PROJECT_ID,
    definition_id: DEFINITION_ID,
    name: 'deploy-web',
    status: 'running',
    trigger_payload: {},
    created_at: '2026-05-07T01:01:00.000Z',
    updated_at: '2026-05-07T01:02:00.000Z',
    jobs: [
      workflowJobDto({
        id: BUILD_JOB_ID,
        run_id: RUN_ID,
        name: 'build',
        status: 'succeeded',
        steps: [
          workflowStepDto({
            id: CHECKOUT_STEP_ID,
            job_id: BUILD_JOB_ID,
            name: 'checkout',
            display_name: 'checkout',
            status: 'succeeded',
            attempts: [
              workflowStepAttemptDto({
                id: CHECKOUT_ATTEMPT_ID,
                step_id: CHECKOUT_STEP_ID,
                job_id: BUILD_JOB_ID,
                status: 'succeeded',
                exit_code: 0,
                finished_at: '2026-05-07T01:01:20.000Z',
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
      }),
    ],
    ...overrides,
  });
}
