import {configureApiClient, resetApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  workflowJobDetailResponseDto,
  workflowJobDto,
  workflowJobExecutionDto,
  workflowRunFixtureDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {WorkflowRunActionSource} from './workflow-run-action-source.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '44444444-4444-4444-8444-0000000000a1';
const EXECUTION_ID = '77777777-7777-4777-8777-0000000000a1';
const OUTER_ID = '55555555-5555-4555-8555-0000000000a1';
const INNER_ID = '55555555-5555-4555-8555-0000000000a2';
const LEAF_ID = '55555555-5555-4555-8555-0000000000a3';
const DIGEST = 'sha256:abc123';
const SETUP_FILE = {
  kind: 'action',
  uses: './.shipfox/actions/setup',
  digest: DIGEST,
  path: 'action.yml',
} as const;
const OUTER_FILE = {
  kind: 'action',
  uses: './.shipfox/actions/review',
  digest: 'sha256:def456',
  path: 'action.yml',
} as const;
const ACTION_FILE_PATH = `/workflows/runs/${RUN_ID}/action-snapshots/sha256%3Aabc123/files/action.yml`;

describe('WorkflowRunActionSource', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetApiClient();
  });

  test('shows the composite file with a path back to each calling step', async () => {
    const user = userEvent.setup();
    const onSelectCaller = vi.fn();
    configureResponses({fileStatus: 200});

    renderSource({onSelectCaller});

    const path = await screen.findByRole('navigation', {name: 'Source path'});
    expect(
      await within(path).findByRole('button', {name: 'workflow.yaml:12-15'}),
    ).toBeInTheDocument();
    expect(
      within(path).getByRole('button', {name: './.shipfox/actions/review/action.yml:4'}),
    ).toBeInTheDocument();
    expect(within(path).getByText('./.shipfox/actions/setup/action.yml')).toHaveAttribute(
      'aria-current',
      'location',
    );
    const highlighted = document.body.querySelectorAll('.line.highlighted-line');
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0]).toHaveTextContent('run: ./scripts/changed-files.sh');

    await user.click(within(path).getByRole('button', {name: 'workflow.yaml:12-15'}));

    expect(onSelectCaller).toHaveBeenCalledWith(OUTER_ID);
  });

  test('explains a file that the snapshot does not include', async () => {
    configureResponses({fileStatus: 404});

    renderSource();

    expect(await screen.findByText('Action source unavailable')).toBeInTheDocument();
  });
});

function renderSource({onSelectCaller}: {onSelectCaller?: (stepId: string) => void} = {}) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkflowRunActionSource
        workflowRunId={RUN_ID}
        file={SETUP_FILE}
        highlightedLineRange={{startLine: 3, endLine: 3, file: SETUP_FILE}}
        step={{jobId: JOB_ID, jobExecutionId: EXECUTION_ID, stepId: LEAF_ID}}
        onSelectCaller={onSelectCaller}
      />
    </QueryClientProvider>,
  );
}

function configureResponses({fileStatus}: {fileStatus: 200 | 404}) {
  const detail = workflowRunFixtureDto({
    id: RUN_ID,
    jobs: [
      workflowJobDto({
        id: JOB_ID,
        job_executions: [
          workflowJobExecutionDto({
            id: EXECUTION_ID,
            job_id: JOB_ID,
            steps: [
              workflowStepDto({
                id: OUTER_ID,
                key: 'review',
                type: 'composite',
                position: 1,
                source_location: {start_line: 12, end_line: 15},
              }),
              workflowStepDto({
                id: INNER_ID,
                parent_step_id: OUTER_ID,
                key: 'setup',
                type: 'composite',
                position: 2,
                source_location: {start_line: 4, end_line: 4, file: OUTER_FILE},
              }),
              workflowStepDto({
                id: LEAF_ID,
                parent_step_id: INNER_ID,
                key: 'changed_files',
                position: 3,
                source_location: {start_line: 3, end_line: 3, file: SETUP_FILE},
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const jobDetail = workflowJobDetailResponseDto({
    detail,
    jobId: JOB_ID,
    executionId: EXECUTION_ID,
  });
  const responseFor = (url: string): Response => {
    if (url.includes(ACTION_FILE_PATH)) {
      return fileStatus === 404
        ? jsonResponse({code: 'not-found'}, {status: 404})
        : jsonResponse({
            digest: DIGEST,
            path: 'action.yml',
            content: 'name: Setup\nsteps:\n  - run: ./scripts/changed-files.sh\n',
          });
    }
    if (url.includes(`/workflows/runs/jobs/${JOB_ID}`)) return jsonResponse(jobDetail);
    return jsonResponse({code: 'not-found'}, {status: 404});
  };
  configureApiClient({
    fetchImpl: vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(responseFor(input instanceof Request ? input.url : String(input))),
    ),
  });
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}
