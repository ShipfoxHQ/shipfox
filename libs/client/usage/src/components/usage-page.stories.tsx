import {
  type ClientUsagePricing,
  ClientUsagePricingProvider,
  type UsagePricingReferenceKind,
} from '@shipfox/client-shell/runtime';
import {Badge} from '@shipfox/react-ui/badge';
import {Panel, PanelBody, PanelHeader, PanelTitle} from '@shipfox/react-ui/panel';
import {Code, Header, Text} from '@shipfox/react-ui/typography';
import type {Decorator, Meta, StoryObj} from '@storybook/react';
import type {
  JobExecutionUsage,
  RunUsage,
  UsageInferenceSegment,
  UsageJobExecution,
  UsageTokenClasses,
} from '#core/usage.js';
import {JobUsageCells} from './job-usage-cells.js';
import {RunUsageSummary} from './run-usage-summary.js';
import {StepInferenceTable} from './step-inference-table.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const BUILD_JOB_ID = '33333333-3333-4333-8333-333333333333';
const BUILD_EXECUTION_ID = '44444444-4444-4444-8444-444444444444';
const VERIFY_JOB_ID = '55555555-5555-4555-8555-555555555555';
const VERIFY_EXECUTION_ID = '66666666-6666-4666-8666-666666666666';
const BUILD_GENERATE_STEP_ID = '77777777-7777-4777-8777-777777777777';
const BUILD_GENERATE_ATTEMPT_ID = '88888888-8888-4888-8888-888888888888';
const BUILD_TEST_STEP_ID = '99999999-9999-4999-8999-999999999999';
const BUILD_TEST_ATTEMPT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VERIFY_REVIEW_STEP_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const VERIFY_REVIEW_ATTEMPT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const BUILD_EXECUTION = usageJobExecution({
  jobId: BUILD_JOB_ID,
  jobExecutionId: BUILD_EXECUTION_ID,
  jobKey: 'build',
  durationSeconds: 178,
});
const VERIFY_EXECUTION = usageJobExecution({
  jobId: VERIFY_JOB_ID,
  jobExecutionId: VERIFY_EXECUTION_ID,
  jobKey: 'verify',
  durationSeconds: 92,
});

const BUILD_SEGMENTS = [
  usageInferenceSegment({
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    jobId: BUILD_JOB_ID,
    jobExecutionId: BUILD_EXECUTION_ID,
    stepId: BUILD_GENERATE_STEP_ID,
    stepAttemptId: BUILD_GENERATE_ATTEMPT_ID,
    upstream: 'anthropic',
    model: 'claude-sonnet-4',
    dialect: 'anthropic-messages',
    requestCount: 12,
    inputTokens: 8_200,
    outputTokens: 2_100,
    cacheCreationTokens: 900,
    cacheReadTokens: 1_300,
    reasoningTokens: 300,
    webSearchRequests: 2,
    tokenClasses: {
      inputTokens: 8_200,
      cachedInputTokens: 1_300,
      cacheWriteTokens: 900,
      outputTokens: 2_100,
      totalTokens: 12_500,
      cacheHitRate: 1_300 / 9_500,
    },
  }),
  usageInferenceSegment({
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    jobId: BUILD_JOB_ID,
    jobExecutionId: BUILD_EXECUTION_ID,
    stepId: BUILD_TEST_STEP_ID,
    stepAttemptId: BUILD_TEST_ATTEMPT_ID,
    upstream: 'openai',
    model: 'gpt-5',
    dialect: 'openai-responses',
    requestCount: 8,
    inputTokens: 14_600,
    outputTokens: 3_400,
    cacheReadTokens: 2_400,
    reasoningTokens: 900,
    tokenClasses: {
      inputTokens: 12_200,
      cachedInputTokens: 2_400,
      cacheWriteTokens: 0,
      outputTokens: 3_400,
      totalTokens: 18_000,
      cacheHitRate: 2_400 / 14_600,
    },
  }),
];

const VERIFY_SEGMENTS = [
  usageInferenceSegment({
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    jobId: VERIFY_JOB_ID,
    jobExecutionId: VERIFY_EXECUTION_ID,
    stepId: VERIFY_REVIEW_STEP_ID,
    stepAttemptId: VERIFY_REVIEW_ATTEMPT_ID,
    upstream: 'anthropic',
    model: 'claude-sonnet-4',
    dialect: 'anthropic-messages',
    requestCount: 4,
    inputTokens: 3_400,
    outputTokens: 800,
    cacheCreationTokens: 500,
    cacheReadTokens: 800,
    reasoningTokens: 100,
    webSearchRequests: 1,
    tokenClasses: {
      inputTokens: 3_400,
      cachedInputTokens: 800,
      cacheWriteTokens: 500,
      outputTokens: 800,
      totalTokens: 5_500,
      cacheHitRate: 800 / 4_200,
    },
  }),
];

const RUN_USAGE: RunUsage = {
  jobExecutions: [BUILD_EXECUTION, VERIFY_EXECUTION],
  inferenceSegments: [...BUILD_SEGMENTS, ...VERIFY_SEGMENTS],
};
const BUILD_USAGE: JobExecutionUsage = {
  jobExecution: BUILD_EXECUTION,
  inferenceSegments: BUILD_SEGMENTS,
};
const VERIFY_USAGE: JobExecutionUsage = {
  jobExecution: VERIFY_EXECUTION,
  inferenceSegments: VERIFY_SEGMENTS,
};

const BUILD_STEP_LABELS = new Map([
  [BUILD_GENERATE_STEP_ID, 'Generate release notes'],
  [BUILD_TEST_STEP_ID, 'Run verification tests'],
]);
const BUILD_ATTEMPT_LABELS = new Map([
  [BUILD_GENERATE_ATTEMPT_ID, '1'],
  [BUILD_TEST_ATTEMPT_ID, '1'],
]);

const pricing: ClientUsagePricing = {
  resolveCosts: (refs) =>
    new Map(
      refs.map((reference) => [
        `${reference.kind}:${reference.id}`,
        {
          amount: pricingAmount(reference.kind),
          state: 'resolved' as const,
        },
      ]),
    ),
  estimate: () => ({amount: 1.47, state: 'estimated' as const}),
  formatMoney: (amount) => `$${amount.toFixed(2)}`,
};

function pricingAmount(kind: UsagePricingReferenceKind): number {
  if (kind === 'run') return 4.86;
  if (kind === 'job-execution') return 3.21;
  return 1.47;
}

const withPricing: Decorator = (Story) => (
  <ClientUsagePricingProvider usagePricing={pricing}>
    <Story />
  </ClientUsagePricingProvider>
);

const meta = {
  title: 'Usage/WorkflowPages',
  parameters: {
    layout: 'fullscreen',
    viewport: {
      defaultViewport: 'wide',
      options: {
        wide: {
          name: 'Wide',
          styles: {width: '1440px', height: '900px'},
          type: 'desktop',
        },
      },
    },
    globals: {viewport: {value: 'wide'}},
    argos: {fitToContent: false},
  },
  decorators: [withPricing],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const RunPage: Story = {
  render: () => (
    <PageFrame>
      <PageHeader
        eyebrow="Workflow run"
        title="deploy-web"
        detail="Run #42 · succeeded · 2 jobs"
        status="Succeeded"
      >
        <RunUsageSummary runId={RUN_ID} usage={RUN_USAGE} />
      </PageHeader>

      <Panel>
        <PanelHeader>
          <PanelTitle>Jobs</PanelTitle>
          <Text as="p" size="xs" className="mt-tight text-foreground-neutral-muted">
            Usage is visible alongside each job in the run overview.
          </Text>
        </PanelHeader>
        <PanelBody className="p-0">
          <ul className="divide-y divide-border-neutral-base">
            <WorkflowJobRow
              name="Build application"
              detail="build · succeeded"
              usage={BUILD_USAGE}
            />
            <WorkflowJobRow
              name="Verify release"
              detail="verify · succeeded"
              usage={VERIFY_USAGE}
            />
            <WorkflowJobRow name="Publish artifacts" detail="publish · skipped" />
          </ul>
        </PanelBody>
      </Panel>
    </PageFrame>
  ),
};

export const JobPage: Story = {
  render: () => (
    <PageFrame>
      <PageHeader
        eyebrow="Job execution"
        title="Build application"
        detail="deploy-web / run #42 · execution 1 · succeeded"
        status="Succeeded"
      >
        <JobUsageCells usage={BUILD_USAGE} />
      </PageHeader>

      <StepInferenceTable
        usage={BUILD_USAGE}
        stepLabels={BUILD_STEP_LABELS}
        stepAttemptLabels={BUILD_ATTEMPT_LABELS}
      />

      <Panel>
        <PanelHeader>
          <PanelTitle>Logs</PanelTitle>
        </PanelHeader>
        <PanelBody className="bg-background-code p-panel-compact">
          <Code
            as="pre"
            variant="paragraph"
            className="whitespace-pre-wrap text-foreground-on-inverted"
          >
            $ pnpm test --filter=@shipfox/client-usage{`\n`}24 tests passed{`\n`}$ shipfox release
            verify
          </Code>
        </PanelBody>
      </Panel>
    </PageFrame>
  ),
};

function PageFrame({children}: {children: React.ReactNode}) {
  return (
    <div className="min-h-screen bg-background-subtle-base px-frame py-frame">
      <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-16">{children}</main>
    </div>
  );
}

function PageHeader({
  eyebrow,
  title,
  detail,
  status,
  children,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  status: string;
  children: React.ReactNode;
}) {
  return (
    <header className="flex min-w-0 flex-col gap-inline border-b border-border-neutral-base pb-16">
      <Text as="p" size="xs" className="text-foreground-neutral-muted">
        {eyebrow}
      </Text>
      <div className="flex min-w-0 flex-wrap items-center gap-inline">
        <Badge variant="success" size="xs">
          {status}
        </Badge>
        <Header as="h1" variant="h2" className="min-w-0 truncate">
          {title}
        </Header>
      </div>
      <Text as="p" size="xs" className="text-foreground-neutral-subtle">
        {detail}
      </Text>
      <div className="flex min-w-0 flex-wrap items-center gap-inline text-foreground-neutral-muted">
        {children}
      </div>
    </header>
  );
}

function WorkflowJobRow({
  name,
  detail,
  usage,
}: {
  name: string;
  detail: string;
  usage?: JobExecutionUsage;
}) {
  return (
    <li className="flex min-w-0 items-center gap-cluster px-row py-row">
      <div className="min-w-0 flex-1">
        <Text as="p" size="sm" className="truncate text-foreground-neutral-base">
          {name}
        </Text>
        <Code as="span" variant="label" className="text-foreground-neutral-muted">
          {detail}
        </Code>
      </div>
      {usage ? <JobUsageCells usage={usage} /> : <Code variant="label">—</Code>}
    </li>
  );
}

function usageJobExecution({
  jobId,
  jobExecutionId,
  jobKey,
  durationSeconds,
}: {
  jobId: string;
  jobExecutionId: string;
  jobKey: string;
  durationSeconds: number;
}): UsageJobExecution {
  return {
    jobId,
    jobExecutionId,
    workflowRunId: RUN_ID,
    workflowRunAttemptId: RUN_ATTEMPT_ID,
    workspaceId: 'dddddddd-dddd-4ddd-8ddd-ddddddddddde',
    projectId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeef',
    definitionId: 'ffffffff-ffff-4fff-8fff-fffffffffff0',
    jobKey,
    runNumber: 42,
    requestedLabels: ['linux', 'x86_64'],
    runnerLabels: ['linux', 'x86_64'],
    templateKey: 'ubuntu-24.04',
    provisionerId: null,
    provisionerScope: null,
    providerKind: 'managed',
    launchKind: 'ephemeral',
    runnerClass: 'standard',
    runnerArch: 'x86_64',
    runnerCpu: '4',
    managed: true,
    queuedAt: '2026-06-26T11:59:00.000Z',
    startedAt: '2026-06-26T11:59:05.000Z',
    finishedAt: '2026-06-26T12:03:00.000Z',
    leaseExpiredAt: null,
    status: 'succeeded',
    statusReason: null,
    cancellationReason: null,
    durationSeconds,
    state: 'terminated',
    recordedAt: '2026-06-26T12:03:00.000Z',
  };
}

function usageInferenceSegment({
  id,
  jobId,
  jobExecutionId,
  stepId,
  stepAttemptId,
  upstream,
  model,
  dialect,
  requestCount,
  inputTokens,
  outputTokens,
  cacheCreationTokens = 0,
  cacheReadTokens,
  reasoningTokens,
  webSearchRequests = 0,
  tokenClasses,
}: {
  id: string;
  jobId: string;
  jobExecutionId: string;
  stepId: string;
  stepAttemptId: string;
  upstream: string;
  model: UsageInferenceSegment['model'];
  dialect: UsageInferenceSegment['dialect'];
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  webSearchRequests?: number;
  tokenClasses: UsageTokenClasses;
}): UsageInferenceSegment {
  return {
    id,
    segmentKey: `${jobId}:${stepAttemptId}`,
    source: 'gateway',
    workspaceId: 'dddddddd-dddd-4ddd-8ddd-ddddddddddde',
    projectId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeef',
    workflowRunId: RUN_ID,
    workflowRunAttemptId: RUN_ATTEMPT_ID,
    jobId,
    jobExecutionId,
    stepId,
    stepAttemptId,
    upstream,
    model,
    dialect,
    windowStart: '2026-06-26T11:59:20.000Z',
    windowEnd: '2026-06-26T11:59:30.000Z',
    requestCount,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    reasoningTokens,
    webSearchRequests,
    tokenClasses,
    recordedAt: '2026-06-26T11:59:30.000Z',
  };
}
