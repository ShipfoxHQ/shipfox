import {
  type ClientUsagePricing,
  ClientUsagePricingProvider,
  type UsagePricingCost,
  usagePricingReferenceKey,
} from '@shipfox/client-shell/runtime';
import {type JobExecutionUsage, type RunUsage, usageQueryKeys} from '@shipfox/client-usage';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useRef, useState} from 'react';
import {userEvent, within} from 'storybook/test';
import type {WorkflowJobExecutionContext, WorkflowJobExecutionDetail} from '#core/workflow-run.js';
import {workflowJobQueryKeys} from '#hooks/api/workflow-job-detail.js';
import {
  workflowJobExecutionDto,
  workflowRunOverview,
  workflowRunOverviewJob,
} from '#test/fixtures/workflow-run.js';
import {WorkflowInspector} from './workflow-inspector.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '44444444-4444-4444-8444-000000000001';
const EXECUTION_ID = '77777777-7777-4777-8777-000000000001';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_ID = '88888888-8888-4888-8888-888888888888';
const RUN_ATTEMPT_ID = '33333333-3333-4333-8333-333333333333';
const STEP_ID = '55555555-5555-4555-8555-555555555555';
const STEP_ATTEMPT_ID = '66666666-6666-4666-8666-666666666666';

const meta = {
  title: 'Workflows/WorkflowInspector',
  parameters: {
    layout: 'fullscreen',
    argos: {modes: {dark: {theme: 'dark'}}, fitToContent: false},
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const RunScope: Story = {
  render: () => <InspectorStory scope="run" />,
};

export const RunGitHubTrigger: Story = {
  render: () => <InspectorStory scope="run" githubTrigger />,
};

export const ExecutionRunning: Story = {
  render: () => <InspectorStory scope="execution" status="running" />,
};

export const FailedCondition: Story = {
  render: () => <InspectorStory scope="execution" status="failed" />,
  play: async ({canvasElement}) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole('tab', {name: 'Decisions'}));
  },
};

export const RunCostWithUsage: Story = {
  render: () => <InspectorStory scope="run" runStatus="failed" />,
  play: async ({canvasElement}) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole('tab', {name: 'Cost'}));
  },
};

export const ExecutionCostWithUsage: Story = {
  render: () => <InspectorStory scope="execution" status="failed" />,
  play: async ({canvasElement}) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole('tab', {name: 'Cost'}));
  },
};

export const ExecutionCostDetails: Story = {
  render: () => <InspectorStory scope="execution" status="failed" />,
  play: async ({canvasElement}) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole('tab', {name: 'Cost'}));
    await userEvent.click(await body.findByText('Pricing and request details'));
  },
};

export const NarrowSheet: Story = {
  render: () => <InspectorStory scope="run" />,
  parameters: {
    viewport: {
      defaultViewport: 'mobile',
      options: {
        mobile: {name: 'Mobile', styles: {width: '390px', height: '844px'}, type: 'mobile'},
      },
    },
    globals: {viewport: {value: 'mobile'}},
  },
};

export const NarrowCostSheet: Story = {
  ...ExecutionCostWithUsage,
  parameters: NarrowSheet.parameters,
};

function InspectorStory({
  scope,
  status = 'failed',
  runStatus,
  githubTrigger = false,
}: {
  scope: 'run' | 'execution';
  status?: 'running' | 'failed';
  runStatus?: 'succeeded' | 'failed';
  githubTrigger?: boolean;
}) {
  const selection = executionSelection(status);
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      defaultOptions: {queries: {retry: false, staleTime: Infinity}},
    });
    client.setQueryData(workflowJobQueryKeys.context(EXECUTION_ID), executionContext());
    client.setQueryData(usageQueryKeys.jobExecution(WORKSPACE_ID, EXECUTION_ID), executionUsage);
    return client;
  });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const run = workflowRunOverview({
    id: RUN_ID,
    status: runStatus ?? (scope === 'run' ? 'succeeded' : status),
    current_attempt: 2,
    latest_attempt: 2,
    secret_inputs: {
      DEPLOY_TOKEN: {store: 'local', key: 'PROD_DEPLOY_TOKEN', project_id: PROJECT_ID},
    },
    ...(githubTrigger
      ? {
          trigger_provider: 'github',
          trigger_source: 'github_acme',
          trigger_event: 'push',
          trigger_reference: {
            repository: 'acme/platform',
            ref: 'refs/heads/main',
            commit: '0123456789abcdef0123456789abcdef01234567',
            actor: 'octocat',
          },
        }
      : {}),
  });

  return (
    <ClientUsagePricingProvider usagePricing={usagePricing}>
      <QueryClientProvider client={queryClient}>
        <div className="flex h-[720px] w-full justify-end bg-background-subtle-base">
          <WorkflowInspector
            scope={scope}
            run={run}
            projectSlug="platform"
            workspaceId={WORKSPACE_ID}
            runUsage={runUsage}
            executionSelection={selection}
            headingRef={headingRef}
            onClose={() => undefined}
          />
        </div>
      </QueryClientProvider>
    </ClientUsagePricingProvider>
  );
}

const jobExecution: RunUsage['jobExecutions'][number] = {
  jobId: JOB_ID,
  jobExecutionId: EXECUTION_ID,
  workflowRunId: RUN_ID,
  workflowRunAttemptId: RUN_ATTEMPT_ID,
  workspaceId: WORKSPACE_ID,
  projectId: PROJECT_ID,
  definitionId: null,
  jobKey: 'deploy-production',
  runNumber: 42,
  requestedLabels: ['production'],
  runnerLabels: ['managed', 'linux-x64', 'production'],
  templateKey: 'ubuntu',
  provisionerId: null,
  provisionerScope: null,
  providerKind: 'managed',
  launchKind: 'ephemeral',
  runnerClass: 'standard',
  runnerArch: 'x86_64',
  runnerCpu: '4',
  managed: true,
  queuedAt: '2026-09-22T17:00:00.000Z',
  startedAt: '2026-09-22T17:00:03.000Z',
  finishedAt: '2026-09-22T17:00:08.000Z',
  leaseExpiredAt: null,
  status: 'failed',
  statusReason: 'condition_false',
  cancellationReason: null,
  durationSeconds: 5,
  state: 'terminated',
  recordedAt: '2026-09-22T17:00:08.000Z',
};

const inferenceSegments: RunUsage['inferenceSegments'] = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    segmentKey: 'gateway:deploy:plan',
    source: 'gateway',
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    workflowRunId: RUN_ID,
    workflowRunAttemptId: RUN_ATTEMPT_ID,
    jobId: JOB_ID,
    jobExecutionId: EXECUTION_ID,
    stepId: STEP_ID,
    stepAttemptId: STEP_ATTEMPT_ID,
    model: 'claude-sonnet-4',
    dialect: 'anthropic-messages',
    windowStart: '2026-09-22T17:00:03.000Z',
    windowEnd: '2026-09-22T17:00:07.000Z',
    requestCount: 2,
    inputTokens: 4_200,
    outputTokens: 900,
    cacheCreationTokens: 0,
    cacheReadTokens: 800,
    reasoningTokens: 120,
    webSearchRequests: 1,
    tokenClasses: {
      inputTokens: 3_400,
      cachedInputTokens: 800,
      cacheWriteTokens: 0,
      outputTokens: 900,
      totalTokens: 5_100,
      cacheHitRate: 800 / 4_200,
    },
    recordedAt: '2026-09-22T17:00:08.000Z',
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    segmentKey: 'gateway:deploy:check',
    source: 'gateway',
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    workflowRunId: RUN_ID,
    workflowRunAttemptId: RUN_ATTEMPT_ID,
    jobId: JOB_ID,
    jobExecutionId: EXECUTION_ID,
    stepId: STEP_ID,
    stepAttemptId: STEP_ATTEMPT_ID,
    model: 'gpt-5',
    dialect: 'openai-responses',
    windowStart: '2026-09-22T17:00:07.000Z',
    windowEnd: '2026-09-22T17:00:08.000Z',
    requestCount: 1,
    inputTokens: 1_500,
    outputTokens: 350,
    cacheCreationTokens: 0,
    cacheReadTokens: 300,
    reasoningTokens: 70,
    webSearchRequests: 0,
    tokenClasses: {
      inputTokens: 1_200,
      cachedInputTokens: 300,
      cacheWriteTokens: 0,
      outputTokens: 350,
      totalTokens: 1_850,
      cacheHitRate: 300 / 1_500,
    },
    recordedAt: '2026-09-22T17:00:08.000Z',
  },
];

const runUsage: RunUsage = {jobExecutions: [jobExecution], inferenceSegments};
const executionUsage: JobExecutionUsage = {jobExecution, inferenceSegments};

const pricedCost: UsagePricingCost = {
  amount: 0.39,
  state: 'resolved',
  breakdown: {
    machine: {amount: 0.04, state: 'resolved'},
    modelUsage: {amount: 0.35, state: 'resolved'},
    models: [
      {
        model: 'claude-sonnet-4',
        cost: {amount: 0.28, state: 'resolved'},
        skus: [
          {
            sku: 'input',
            label: 'Input tokens',
            quantity: 3_400,
            unit: 'tokens',
            rate: '$60.00 / 1M tokens',
            cost: {amount: 0.2, state: 'resolved'},
          },
          {
            sku: 'output',
            label: 'Output tokens',
            quantity: 900,
            unit: 'tokens',
            rate: '$90.00 / 1M tokens',
            cost: {amount: 0.08, state: 'resolved'},
          },
        ],
      },
      {
        model: 'gpt-5',
        cost: {amount: 0.07, state: 'resolved'},
        skus: [
          {
            sku: 'input',
            label: 'Input tokens',
            quantity: 1_200,
            unit: 'tokens',
            rate: '$40.00 / 1M tokens',
            cost: {amount: 0.05, state: 'resolved'},
          },
          {
            sku: 'output',
            label: 'Output tokens',
            quantity: 350,
            unit: 'tokens',
            rate: '$60.00 / 1M tokens',
            cost: {amount: 0.02, state: 'resolved'},
          },
        ],
      },
    ],
  },
};

const usagePricing: ClientUsagePricing = {
  resolveCosts: (references) =>
    new Map(references.map((reference) => [usagePricingReferenceKey(reference), pricedCost])),
  estimate: () => pricedCost,
  formatMoney: (amount) => `$${amount.toFixed(2)}`,
};

function executionSelection(status: 'running' | 'failed') {
  const job = workflowRunOverviewJob({
    id: JOB_ID,
    name: 'deploy-production',
    status,
    status_reason: status === 'failed' ? 'condition_false' : null,
    job_executions: [workflowJobExecutionDto({id: EXECUTION_ID, status})],
  });
  return {job, execution: execution(status)};
}

function execution(status: 'running' | 'failed'): WorkflowJobExecutionDetail {
  const running = status === 'running';
  return {
    id: EXECUTION_ID,
    jobId: JOB_ID,
    sequence: 2,
    name: 'production',
    status,
    displayStatus: status,
    statusReason: running ? null : 'condition_false',
    statusReasonMessage: running ? null : 'The production condition evaluated to false.',
    queuedAt: '2026-09-22T17:00:00.000Z',
    startedAt: '2026-09-22T17:00:03.000Z',
    finishedAt: running ? null : '2026-09-22T17:00:08.000Z',
    timedOutAt: null,
    updatedAt: '2026-09-22T17:00:08.000Z',
    displayDuration: null,
    hasContext: true,
    steps: {items: [], nextCursor: null},
  };
}

function executionContext(): WorkflowJobExecutionContext {
  const trace = {
    roots: ['inputs.environment'],
    fillTarget: 'job-activation',
    evaluatedAt: '2026-09-22T17:00:00.000Z',
  };
  return {
    workflowRunId: RUN_ID,
    workflowRunAttempt: 2,
    jobId: JOB_ID,
    jobExecutionId: EXECUTION_ID,
    jobRunner: ['managed', 'linux-x64'],
    executionRunner: ['production'],
    jobOutputs: {
      artifact: 'https://example.com/builds/very-long-production-artifact-name',
      deployment: {environment: 'production', sha: 'd34db33f'},
    },
    executionOutputs: null,
    triggerEvents: [
      {
        source: 'github',
        event: 'push',
        deliveryId: 'delivery-production-1234567890',
        receivedAt: '2026-09-22T17:00:00.000Z',
        project: {id: PROJECT_ID},
        repository: 'shipfox/platform-v1',
        ref: 'refs/heads/main',
        commit: 'd34db33f',
        data: {branch: 'main', sender: 'octocat'},
      },
    ],
    condition: 'inputs.environment == "production"',
    jobEvaluationTrace: [
      {
        ...trace,
        expression: 'inputs.environment == "production"',
        field: 'job.if',
        value: 'false',
      },
    ],
    executionEvaluationTrace: [
      {
        ...trace,
        expression: 'inputs.environment',
        field: 'job.execution_name',
        value: 'production',
      },
    ],
    oversizedFields: [
      {
        field: 'execution_outputs',
        storedBytes: 70_000,
        reason: 'legacy_value_exceeds_inline_limit',
      },
    ],
  };
}
