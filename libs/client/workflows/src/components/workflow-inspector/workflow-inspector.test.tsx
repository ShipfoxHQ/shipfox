import type {WorkflowJobExecutionContextResponseDto} from '@shipfox/api-workflows-dto';
import {configureApiClient, resetApiClient} from '@shipfox/client-api';
import {type JobExecutionUsage, type RunUsage, usageQueryKeys} from '@shipfox/client-usage';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {createRef, type ReactElement} from 'react';
import type {WorkflowJobExecutionContext, WorkflowJobExecutionDetail} from '#core/workflow-run.js';
import {workflowJobQueryKeys} from '#hooks/api/workflow-job-detail.js';
import {
  workflowJobExecutionDto,
  workflowRunOverview,
  workflowRunOverviewJob,
} from '#test/fixtures/workflow-run.js';
import {WorkflowInspector, type WorkflowInspectorProps} from './workflow-inspector.js';

const WORKSPACE_ID = '55555555-5555-4555-8555-555555555555';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '44444444-4444-4444-8444-000000000001';
const EXECUTION_ID = '77777777-7777-4777-8777-000000000001';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const ARTIFACT_URL_PATTERN = /https:\/\/example\.test\/artifact/;
const EVENT_PAYLOAD_PATTERN = /Payload of github push/;
const EVENT_DATA_PATTERN = /"branch": "main"/;

describe('WorkflowInspector', () => {
  afterEach(() => {
    resetApiClient();
    vi.restoreAllMocks();
  });

  test('shows run inputs and whole-run cost without exposing secret values', async () => {
    const run = workflowRunOverview({
      id: RUN_ID,
      current_attempt: 2,
      latest_attempt: 2,
      secret_inputs: {
        DEPLOY_TOKEN: {store: 'local', key: 'PROD_DEPLOY_TOKEN', project_id: PROJECT_ID},
      },
    });

    renderInspector({scope: 'run', run, projectSlug: 'project', runUsage: emptyRunUsage()});

    expect(await screen.findByRole('heading', {name: run.name})).toHaveFocus();
    const secretInputs = screen.getByRole('region', {name: 'Secret inputs'});
    expect(within(secretInputs).getByText('DEPLOY_TOKEN')).toBeVisible();
    expect(within(secretInputs).getByText('PROD_DEPLOY_TOKEN')).toBeVisible();
    expect(within(secretInputs).getByText('Project project')).toBeVisible();
    expect(screen.queryByText('super-secret-value')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', {name: 'Cost'}));
    expect(screen.getByText('Totals include all attempts.')).toBeVisible();
    expect(screen.getByText('Machine')).toBeVisible();
  });

  test('renders execution results, inputs, decisions, and cost from one context resource', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {writeText},
    });
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
    queryClient.setQueryData(workflowJobQueryKeys.context(EXECUTION_ID), executionContext());
    queryClient.setQueryData(
      usageQueryKeys.jobExecution(WORKSPACE_ID, EXECUTION_ID),
      jobExecutionUsage(),
    );

    renderInspector(
      {
        scope: 'execution',
        executionSelection: executionSelection(),
        workspaceId: WORKSPACE_ID,
      },
      queryClient,
    );

    expect(await screen.findByText('Job outputs')).toBeVisible();
    expect(screen.getByText('string')).toBeVisible();
    expect(screen.getByRole('link', {name: ARTIFACT_URL_PATTERN})).toHaveAttribute(
      'href',
      'https://example.test/artifact',
    );
    await userEvent.click(screen.getByRole('button', {name: 'Copy output artifact'}));
    expect(writeText).toHaveBeenCalledWith('https://example.test/artifact');

    await userEvent.click(screen.getByRole('tab', {name: 'Inputs 1'}));
    expect(screen.getByText('push')).toBeVisible();
    const payload = screen.getByRole('button', {name: EVENT_PAYLOAD_PATTERN});
    expect(payload).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(payload);
    expect(screen.getByText(EVENT_DATA_PATTERN)).toBeVisible();

    await userEvent.click(screen.getByRole('tab', {name: 'Decisions'}));
    expect(screen.getByText('Condition False')).toBeVisible();
    const condition = screen.getByRole('region', {name: 'Condition'});
    expect(within(condition).getByText('false')).toBeVisible();
    expect(within(condition).getByText('inputs.environment == "production"')).toBeVisible();
    const executionName = screen.getByRole('region', {name: 'Execution name'});
    expect(within(executionName).getByText('production')).toBeVisible();

    await userEvent.click(screen.getByRole('tab', {name: 'Cost'}));
    expect(screen.getByText('Machine')).toBeVisible();
  });

  test('loads execution-only resources only when that scope opens', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname.includes('/context')) {
        return Promise.resolve(jsonResponse(executionContextDto()));
      }
      return Promise.resolve(jsonResponse(jobExecutionUsageResponse()));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const run = workflowRunOverview({id: RUN_ID});
    const headingRef = createRef<HTMLHeadingElement>();
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
    const {rerender} = render(
      <QueryClientProvider client={queryClient}>
        <WorkflowInspector
          scope="run"
          run={run}
          workspaceId={WORKSPACE_ID}
          runUsage={undefined}
          executionSelection={executionSelection()}
          headingRef={headingRef}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    rerender(
      <QueryClientProvider client={queryClient}>
        <WorkflowInspector
          scope="execution"
          run={run}
          workspaceId={WORKSPACE_ID}
          runUsage={undefined}
          executionSelection={executionSelection()}
          headingRef={headingRef}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
  });

  test('keeps loaded execution context visible when a refresh fails', async () => {
    configureApiClient({
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}))),
    });
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
    queryClient.setQueryData(workflowJobQueryKeys.context(EXECUTION_ID), executionContext());
    renderInspector({scope: 'execution', executionSelection: executionSelection()}, queryClient);

    expect(await screen.findByText('https://example.test/artifact')).toBeVisible();
    await act(async () => {
      await queryClient.refetchQueries({queryKey: workflowJobQueryKeys.context(EXECUTION_ID)});
    });

    expect(await screen.findByText('Could not refresh execution context.')).toBeVisible();
    expect(screen.getByText('https://example.test/artifact')).toBeVisible();
  });

  test('opens as a modal sheet that closes on outside dismissal', async () => {
    const run = workflowRunOverview({id: RUN_ID});
    const onClose = vi.fn();

    renderInspector({scope: 'run', run, onClose});

    expect(await screen.findByRole('dialog', {name: run.name})).toBeVisible();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

function renderInspector(
  overrides: Partial<WorkflowInspectorProps>,
  queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}}),
) {
  const props: WorkflowInspectorProps = {
    scope: undefined,
    run: undefined,
    runUsage: undefined,
    headingRef: createRef<HTMLHeadingElement>(),
    onClose: vi.fn(),
    ...overrides,
  };
  return renderWithQueryClient(<WorkflowInspector {...props} />, queryClient);
}

function renderWithQueryClient(ui: ReactElement, queryClient: QueryClient) {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function executionSelection() {
  const job = workflowRunOverviewJob({
    id: JOB_ID,
    name: 'build',
    status: 'failed',
    status_reason: 'condition_false',
    job_executions: [workflowJobExecutionDto({id: EXECUTION_ID, status: 'failed'})],
  });
  return {job, execution: selectedExecution()};
}

function selectedExecution(): WorkflowJobExecutionDetail {
  return {
    id: EXECUTION_ID,
    jobId: JOB_ID,
    sequence: 1,
    name: 'production',
    status: 'failed',
    displayStatus: 'failed',
    statusReason: 'condition_false',
    statusReasonMessage: 'The condition evaluated to false.',
    queuedAt: '2026-08-05T12:00:00.000Z',
    startedAt: '2026-08-05T12:00:01.000Z',
    finishedAt: '2026-08-05T12:01:00.000Z',
    timedOutAt: null,
    updatedAt: '2026-08-05T12:01:00.000Z',
    displayDuration: null,
    hasContext: true,
    steps: {items: [], nextCursor: null},
  };
}

function executionContext(): WorkflowJobExecutionContext {
  const traceBase = {
    roots: ['inputs.environment'],
    fillTarget: 'job-activation',
    evaluatedAt: '2026-08-05T12:00:00.000Z',
  };
  return {
    workflowRunId: RUN_ID,
    workflowRunAttempt: 1,
    jobId: JOB_ID,
    jobExecutionId: EXECUTION_ID,
    jobRunner: ['shared-runner'],
    executionRunner: ['linux-x64'],
    jobOutputs: {artifact: 'https://example.test/artifact'},
    executionOutputs: {metadata: {sha: 'abc123'}},
    triggerEvents: [
      {
        source: 'github',
        event: 'push',
        deliveryId: 'delivery-1',
        receivedAt: '2026-08-05T12:00:00.000Z',
        project: {id: PROJECT_ID},
        repository: 'shipfox/platform-v1',
        ref: 'refs/heads/main',
        commit: 'abc123',
        data: {branch: 'main'},
      },
    ],
    condition: 'inputs.environment == "production"',
    jobEvaluationTrace: [
      {
        ...traceBase,
        expression: 'inputs.environment == "production"',
        field: 'job.if',
        value: 'false',
      },
    ],
    executionEvaluationTrace: [
      {
        ...traceBase,
        expression: 'inputs.environment',
        field: 'job.execution_name',
        value: 'production',
      },
    ],
    oversizedFields: [],
  };
}

function executionContextDto(): WorkflowJobExecutionContextResponseDto {
  const context = executionContext();
  return {
    workflow_run_id: context.workflowRunId,
    workflow_run_attempt: context.workflowRunAttempt,
    job_id: context.jobId,
    job_execution_id: context.jobExecutionId,
    job_runner: context.jobRunner,
    execution_runner: context.executionRunner,
    job_outputs: context.jobOutputs,
    execution_outputs: context.executionOutputs,
    trigger_events: context.triggerEvents.map((event) => ({
      source: event.source,
      event: event.event,
      delivery_id: event.deliveryId,
      received_at: event.receivedAt,
      project: event.project,
      repository: event.repository,
      ref: event.ref,
      commit: event.commit,
      data: event.data,
    })),
    job_evaluation_trace: context.jobEvaluationTrace?.map(toTraceDto) ?? null,
    execution_evaluation_trace: context.executionEvaluationTrace?.map(toTraceDto) ?? null,
    condition: context.condition,
    oversized_fields: [],
  };
}

function toTraceDto(entry: NonNullable<WorkflowJobExecutionContext['jobEvaluationTrace']>[number]) {
  if ('dropped' in entry) return entry;
  return {
    expression: entry.expression,
    roots: entry.roots,
    fill_target: entry.fillTarget,
    evaluated_at: entry.evaluatedAt,
    field: entry.field,
    value: entry.value,
  };
}

function emptyRunUsage(): RunUsage {
  return {jobExecutions: [], inferenceSegments: []};
}

function jobExecutionUsage(): JobExecutionUsage {
  return {jobExecution: usageExecution(), inferenceSegments: []};
}

function usageExecution(): JobExecutionUsage['jobExecution'] {
  return {
    jobId: JOB_ID,
    jobExecutionId: EXECUTION_ID,
    workflowRunId: RUN_ID,
    workflowRunAttemptId: '11111111-1111-4111-8111-111111111112',
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    definitionId: null,
    jobKey: 'build',
    runNumber: 42,
    requestedLabels: ['linux'],
    runnerLabels: ['linux'],
    templateKey: null,
    provisionerId: null,
    provisionerScope: null,
    providerKind: 'managed',
    launchKind: 'ephemeral',
    runnerClass: 'standard',
    runnerArch: 'x86_64',
    runnerCpu: '4',
    managed: true,
    queuedAt: '2026-08-05T12:00:00.000Z',
    startedAt: '2026-08-05T12:00:01.000Z',
    finishedAt: '2026-08-05T12:01:00.000Z',
    leaseExpiredAt: null,
    status: 'failed',
    statusReason: 'condition_false',
    cancellationReason: null,
    durationSeconds: 59,
    state: 'terminated',
    recordedAt: '2026-08-05T12:01:00.000Z',
  };
}

function jobExecutionUsageResponse() {
  const usage = usageExecution();
  return {
    job_execution: {
      job_id: usage.jobId,
      job_execution_id: usage.jobExecutionId,
      workflow_run_id: usage.workflowRunId,
      workflow_run_attempt_id: usage.workflowRunAttemptId,
      workspace_id: usage.workspaceId,
      project_id: usage.projectId,
      definition_id: usage.definitionId,
      job_key: usage.jobKey,
      run_number: usage.runNumber,
      requested_labels: usage.requestedLabels,
      runner_labels: usage.runnerLabels,
      template_key: usage.templateKey,
      provisioner_id: usage.provisionerId,
      provisioner_scope: usage.provisionerScope,
      provider_kind: usage.providerKind,
      launch_kind: usage.launchKind,
      runner_class: usage.runnerClass,
      runner_arch: usage.runnerArch,
      runner_cpu: usage.runnerCpu,
      managed: usage.managed,
      queued_at: usage.queuedAt,
      started_at: usage.startedAt,
      finished_at: usage.finishedAt,
      lease_expired_at: usage.leaseExpiredAt,
      status: usage.status,
      status_reason: usage.statusReason,
      cancellation_reason: usage.cancellationReason,
      duration_seconds: usage.durationSeconds,
      state: usage.state,
      recorded_at: usage.recordedAt,
    },
    inference_segments: [],
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}
