// @vitest-environment jsdom
import {type ClientUsagePricing, ClientUsagePricingProvider} from '@shipfox/client-shell/runtime';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import type {
  JobExecutionUsage,
  RunUsage,
  UsageInferenceSegment,
  UsageJobExecution,
} from '#core/usage.js';
import {JobUsageBreakdown, JobUsageCells} from './job-usage-cells.js';
import {RunUsageBreakdown, RunUsageSummary} from './run-usage-summary.js';
import {StepInferenceTable} from './step-inference-table.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const EXECUTION_ID = '33333333-3333-4333-8333-333333333333';
const STEP_ID = '99999999-9999-4999-8999-999999999999';
const STEP_ATTEMPT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const jobExecution: UsageJobExecution = {
  jobId: '22222222-2222-4222-8222-222222222222',
  jobExecutionId: EXECUTION_ID,
  workflowRunId: RUN_ID,
  workflowRunAttemptId: '44444444-4444-4444-8444-444444444444',
  workspaceId: '55555555-5555-4555-8555-555555555555',
  projectId: '66666666-6666-4666-8666-666666666666',
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
  queuedAt: '2026-06-26T11:59:00.000Z',
  startedAt: '2026-06-26T11:59:05.000Z',
  finishedAt: '2026-06-26T12:00:05.000Z',
  leaseExpiredAt: null,
  status: 'succeeded',
  statusReason: null,
  cancellationReason: null,
  durationSeconds: 60,
  state: 'terminated',
  recordedAt: '2026-06-26T12:00:05.000Z',
};

const segment: UsageInferenceSegment = {
  id: '88888888-8888-4888-8888-888888888888',
  segmentKey: 'gateway:build:1',
  source: 'gateway',
  workspaceId: jobExecution.workspaceId,
  projectId: jobExecution.projectId,
  workflowRunId: RUN_ID,
  workflowRunAttemptId: jobExecution.workflowRunAttemptId,
  jobId: jobExecution.jobId,
  jobExecutionId: EXECUTION_ID,
  stepId: STEP_ID,
  stepAttemptId: STEP_ATTEMPT_ID,
  upstream: 'anthropic',
  model: 'claude-sonnet-4',
  dialect: 'anthropic-messages',
  windowStart: '2026-06-26T11:59:20.000Z',
  windowEnd: '2026-06-26T11:59:30.000Z',
  requestCount: 2,
  inputTokens: 1_200,
  outputTokens: 500,
  cacheCreationTokens: 0,
  cacheReadTokens: 100,
  reasoningTokens: 80,
  webSearchRequests: 2,
  tokenClasses: {
    inputTokens: 1_200,
    cachedInputTokens: 100,
    cacheWriteTokens: 0,
    outputTokens: 500,
    totalTokens: 1_800,
    cacheHitRate: 100 / 1_300,
  },
  recordedAt: '2026-06-26T11:59:30.000Z',
};

const runUsage: RunUsage = {
  jobExecutions: [jobExecution],
  inferenceSegments: [segment],
};

const jobUsage: JobExecutionUsage = {
  jobExecution,
  inferenceSegments: [segment],
};

const pricing: ClientUsagePricing = {
  resolveCosts: (refs) =>
    new Map(
      refs.map((reference) => [
        `${reference.kind}:${reference.id}`,
        {amount: 1.2, state: 'resolved'},
      ]),
    ),
  estimate: () => ({amount: 0.9, state: 'estimated'}),
  formatMoney: (amount) => `$${amount.toFixed(2)}`,
};

describe('Usage components', () => {
  test('shares a job pricing snapshot with details and releases it after unmount', async () => {
    const resolveCosts = vi.fn(() => new Map());
    const estimate = vi.fn(() => ({amount: 0.9, state: 'estimated' as const}));
    const sharedPricing = {...pricing, resolveCosts, estimate};
    function Usage({details, mounted = true}: {details: boolean; mounted?: boolean}) {
      return (
        <ClientUsagePricingProvider usagePricing={sharedPricing}>
          {mounted ? <JobUsageCells usage={jobUsage} /> : null}
          {mounted && details ? <JobUsageBreakdown usage={jobUsage} /> : null}
        </ClientUsagePricingProvider>
      );
    }
    const {rerender} = render(<Usage details={false} />);
    await screen.findByText('Est. $0.90');

    rerender(<Usage details />);
    await waitFor(() => expect(screen.getAllByText('Est. $0.90')).toHaveLength(2));
    expect(resolveCosts).toHaveBeenCalledTimes(1);
    expect(estimate).toHaveBeenCalledTimes(1);

    rerender(<Usage details={false} mounted={false} />);
    rerender(<Usage details />);
    await waitFor(() => expect(screen.getAllByText('Est. $0.90')).toHaveLength(2));
    expect(resolveCosts).toHaveBeenCalledTimes(2);
    expect(estimate).toHaveBeenCalledTimes(2);
  });

  test('passes runner identity and model quantities for run and job estimates', async () => {
    const estimate = vi.fn(() => ({amount: 0.9, state: 'estimated' as const}));
    const usagePricing = {...pricing, resolveCosts: () => new Map(), estimate};
    const {unmount} = render(
      <ClientUsagePricingProvider usagePricing={usagePricing}>
        <RunUsageSummary runId={RUN_ID} usage={runUsage} />
      </ClientUsagePricingProvider>,
    );

    await waitFor(() => expect(estimate).toHaveBeenCalledTimes(1));
    expect(estimate).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: {kind: 'run', id: RUN_ID},
        compute: [
          {
            jobExecutionId: EXECUTION_ID,
            runnerLabels: ['linux'],
            templateKey: null,
            seconds: 60,
          },
        ],
        models: [
          expect.objectContaining({
            model: segment.model,
            upstream: segment.upstream,
            quantities: expect.objectContaining({requestCount: 2}),
          }),
        ],
      }),
    );

    unmount();
    estimate.mockClear();
    render(
      <ClientUsagePricingProvider usagePricing={usagePricing}>
        <JobUsageCells usage={jobUsage} />
      </ClientUsagePricingProvider>,
    );

    await waitFor(() => expect(estimate).toHaveBeenCalledTimes(1));
    expect(estimate).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: {kind: 'job-execution', id: EXECUTION_ID},
        compute: [
          {
            jobExecutionId: EXECUTION_ID,
            runnerLabels: ['linux'],
            templateKey: null,
            seconds: 60,
          },
        ],
        models: [expect.objectContaining({model: segment.model, upstream: segment.upstream})],
      }),
    );
  });

  test('does not leave an empty job metadata item without pricing', () => {
    const {container} = render(<JobUsageCells usage={jobUsage} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('keeps recorded model quantities available without per-model unavailable prices', () => {
    render(<JobUsageBreakdown usage={jobUsage} />);
    fireEvent.click(screen.getByText('Model usage'));
    fireEvent.click(screen.getByText(segment.model));
    expect(screen.getByText('Input tokens')).toBeVisible();
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
  });

  test('does not treat an empty run as measured zero usage', async () => {
    const resolveCosts = vi.fn(() => new Map());
    const estimate = vi.fn(() => ({amount: 0, state: 'estimated' as const}));
    const usage: RunUsage = {jobExecutions: [], inferenceSegments: []};
    render(
      <ClientUsagePricingProvider usagePricing={{...pricing, resolveCosts, estimate}}>
        <RunUsageSummary runId={RUN_ID} usage={usage} />
        <RunUsageBreakdown runId={RUN_ID} usage={usage} />
      </ClientUsagePricingProvider>,
    );
    await waitFor(() => expect(resolveCosts).toHaveBeenCalledTimes(1));
    expect(estimate).not.toHaveBeenCalled();
    expect(screen.getByText('Duration unavailable')).toBeVisible();
    expect(screen.queryByText('0s')).not.toBeInTheDocument();
  });

  test('drills into application-priced models and SKUs without estimating an allocation', async () => {
    const estimate = vi.fn(() => null);
    render(
      <ClientUsagePricingProvider
        usagePricing={{
          ...pricing,
          estimate,
          resolveCosts: () =>
            new Map([
              [
                `run:${RUN_ID}`,
                {
                  amount: 1.2,
                  state: 'resolved',
                  breakdown: {
                    machine: {amount: 0.2, state: 'resolved'},
                    modelUsage: {amount: 1, state: 'resolved'},
                    models: [
                      {
                        model: segment.model,
                        upstream: segment.upstream,
                        cost: {amount: 1, state: 'resolved'},
                        skus: [
                          {
                            sku: 'output',
                            label: 'Output tokens',
                            quantity: 500,
                            unit: 'tokens',
                            rate: '$2.00 / 1K tokens',
                            cost: {amount: 1, state: 'resolved'},
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            ]),
        }}
      >
        <RunUsageBreakdown runId={RUN_ID} usage={runUsage} />
      </ClientUsagePricingProvider>,
    );

    await screen.findByText('$0.20');
    const dialog = document.body;
    expect(within(dialog).getByText('$0.20')).toBeVisible();
    expect(within(dialog).getByText(segment.model)).not.toBeVisible();
    fireEvent.click(within(dialog).getByText('Model usage'));
    fireEvent.click(within(dialog).getByText(segment.model));

    expect(within(dialog).getByText('Output tokens')).toBeVisible();
    expect(within(dialog).getByText('500 tokens · $2.00 / 1K tokens')).toBeVisible();
    expect(estimate).not.toHaveBeenCalled();
  });

  test('does not assign a total-only price to machine or model usage', async () => {
    render(
      <ClientUsagePricingProvider usagePricing={pricing}>
        <RunUsageBreakdown runId={RUN_ID} usage={runUsage} />
      </ClientUsagePricingProvider>,
    );

    await screen.findByText('$1.20');

    const dialog = document.body;
    expect(within(dialog).getAllByText('$1.20')).toHaveLength(1);
    expect(
      within(dialog).getByText('Cost breakdown unavailable. Recorded usage is shown below.'),
    ).toBeVisible();
  });

  test('does not estimate a run total from incomplete machine durations', async () => {
    const estimate = vi.fn(() => null);
    const resolveCosts = vi.fn(() => new Map());
    render(
      <ClientUsagePricingProvider usagePricing={{...pricing, estimate, resolveCosts}}>
        <RunUsageSummary
          runId={RUN_ID}
          usage={{...runUsage, jobExecutions: [{...jobExecution, durationSeconds: null}]}}
        />
      </ClientUsagePricingProvider>,
    );

    await waitFor(() => expect(resolveCosts).toHaveBeenCalledTimes(1));

    expect(estimate).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('does not add a summary item when pricing is unavailable', () => {
    render(<RunUsageSummary runId={RUN_ID} usage={runUsage} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('claude-sonnet-4')).not.toBeInTheDocument();
    expect(screen.queryByText('$1.20')).not.toBeInTheDocument();
  });

  test('allows inspecting machine-only jobs', () => {
    render(<JobUsageBreakdown usage={{...jobUsage, inferenceSegments: []}} />);

    expect(screen.getByText('Machine')).toBeVisible();
    expect(screen.getByText('1m 0s')).toBeVisible();
  });

  test('renders resolved cost only when pricing returns one', async () => {
    render(
      <ClientUsagePricingProvider usagePricing={pricing}>
        <RunUsageSummary runId={RUN_ID} usage={runUsage} />
      </ClientUsagePricingProvider>,
    );

    await waitFor(() => expect(screen.getByText('$1.20')).toBeVisible());
    expect(screen.getByText('$1.20')).toHaveAttribute('data-usage-cost-state', 'resolved');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('renders an estimate disclosure once on each usage surface', async () => {
    const disclosure = 'Estimated from list prices. Nothing is billed.';
    const estimate = vi.fn(() => ({amount: 0.9, state: 'estimated' as const}));
    render(
      <ClientUsagePricingProvider
        usagePricing={{...pricing, resolveCosts: () => new Map(), estimate, disclosure}}
      >
        <RunUsageSummary runId={RUN_ID} usage={runUsage} />
        <JobUsageCells usage={jobUsage} />
        <StepInferenceTable usage={jobUsage} />
      </ClientUsagePricingProvider>,
    );

    await waitFor(() => expect(screen.getAllByText(disclosure)).toHaveLength(3));
    expect(screen.getByTitle(disclosure)).toBeVisible();
  });

  test('renders an estimated job cost while preserving job quantities', async () => {
    const estimatingPricing: ClientUsagePricing = {
      ...pricing,
      resolveCosts: () => new Map(),
    };
    render(
      <ClientUsagePricingProvider usagePricing={estimatingPricing}>
        <JobUsageCells usage={jobUsage} />
      </ClientUsagePricingProvider>,
    );

    expect(screen.queryByText('1.8K tokens')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Est. $0.90')).toBeVisible());
    expect(screen.getByText('Est. $0.90')).toHaveAttribute('data-usage-cost-state', 'estimated');
  });

  test('does not estimate a running job with an unknown duration', async () => {
    const resolveCosts = vi.fn(() => new Map());
    const estimate = vi.fn(() => ({amount: 0.9, state: 'estimated' as const}));
    const runningUsage: JobExecutionUsage = {
      ...jobUsage,
      jobExecution: {
        ...jobExecution,
        durationSeconds: null,
        finishedAt: null,
        state: 'running',
        status: null,
      },
    };
    render(
      <ClientUsagePricingProvider usagePricing={{...pricing, resolveCosts, estimate}}>
        <JobUsageCells usage={runningUsage} />
      </ClientUsagePricingProvider>,
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    await waitFor(() => expect(resolveCosts).toHaveBeenCalledTimes(1));
    expect(estimate).not.toHaveBeenCalled();
  });

  test('normalizes an absent pricing resolution before estimating usage', async () => {
    render(
      <ClientUsagePricingProvider
        usagePricing={{...pricing, resolveCosts: () => undefined as never}}
      >
        <JobUsageCells usage={jobUsage} />
      </ClientUsagePricingProvider>,
    );

    expect(screen.queryByText('1.8K tokens')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Est. $0.90')).toBeVisible());
  });

  test('estimates each model row separately for a shared step attempt', async () => {
    const estimate = vi.fn(
      ({
        reference,
        models,
      }: {
        reference: {model?: string; upstream?: string};
        models?: readonly {
          model: string;
          upstream: string;
          quantities: {requestCount: number};
        }[];
      }) => ({
        amount:
          (models ?? []).find(
            (model) => model.model === reference.model && model.upstream === reference.upstream,
          )?.quantities.requestCount ?? 0,
        state: 'estimated' as const,
      }),
    );
    const secondSegment: UsageInferenceSegment = {
      ...segment,
      id: '77777777-7777-4777-8777-777777777777',
      upstream: 'openai',
      model: 'gpt-5',
      dialect: 'openai-responses',
      requestCount: 3,
      inputTokens: 400,
      tokenClasses: {
        inputTokens: 300,
        cachedInputTokens: 100,
        cacheWriteTokens: 0,
        outputTokens: 500,
        totalTokens: 900,
        cacheHitRate: 100 / 400,
      },
    };
    const multipleRowsUsage: JobExecutionUsage = {
      ...jobUsage,
      inferenceSegments: [segment, secondSegment],
    };
    render(
      <ClientUsagePricingProvider
        usagePricing={{...pricing, resolveCosts: () => new Map(), estimate}}
      >
        <StepInferenceTable usage={multipleRowsUsage} />
      </ClientUsagePricingProvider>,
    );

    await waitFor(() => expect(screen.getByText('Est. $2.00')).toBeVisible());
    expect(screen.getByText('Est. $3.00')).toBeVisible();
    expect(estimate).toHaveBeenCalledTimes(2);
    expect(estimate).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: {
          kind: 'step-attempt',
          id: STEP_ATTEMPT_ID,
          model: segment.model,
          upstream: segment.upstream,
        },
        quantities: expect.objectContaining({requestCount: 5}),
        models: expect.arrayContaining([
          expect.objectContaining({model: segment.model, upstream: segment.upstream}),
          expect.objectContaining({model: 'gpt-5', upstream: 'openai'}),
        ]),
      }),
    );
    expect(estimate).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: {
          kind: 'step-attempt',
          id: STEP_ATTEMPT_ID,
          model: 'gpt-5',
          upstream: 'openai',
        },
        quantities: expect.objectContaining({requestCount: 5}),
      }),
    );
  });

  test('does not reload pricing when equivalent request inputs are recreated', async () => {
    const resolveCosts = vi.fn(() => new Map());
    const estimatingPricing: ClientUsagePricing = {
      ...pricing,
      resolveCosts,
    };
    function Usage({revision}: {revision: number}) {
      return (
        <ClientUsagePricingProvider usagePricing={estimatingPricing}>
          <JobUsageCells
            usage={{...jobUsage, inferenceSegments: [...jobUsage.inferenceSegments]}}
            className={String(revision)}
          />
        </ClientUsagePricingProvider>
      );
    }

    const {rerender} = render(<Usage revision={1} />);
    await waitFor(() => expect(resolveCosts).toHaveBeenCalledTimes(1));

    rerender(<Usage revision={2} />);

    expect(resolveCosts).toHaveBeenCalledTimes(1);
  });

  test('renders step inference quantities and hides the absent cost column', () => {
    render(
      <StepInferenceTable
        usage={jobUsage}
        stepLabels={new Map([[STEP_ID, 'Generate release notes']])}
        stepAttemptLabels={new Map([[STEP_ATTEMPT_ID, '1']])}
      />,
    );

    expect(screen.getByText('Generate release notes')).toBeVisible();
    expect(screen.getByRole('table', {name: 'Inference usage'})).toHaveAttribute('tabindex', '0');
    expect(screen.getByText('claude-sonnet-4')).toBeVisible();
    expect(screen.getByText('1.8K')).toBeVisible();
    expect(screen.queryByRole('columnheader', {name: 'Cost'})).not.toBeInTheDocument();
  });

  test('adds the cost column after pricing resolves a step attempt', async () => {
    render(
      <ClientUsagePricingProvider usagePricing={pricing}>
        <StepInferenceTable usage={jobUsage} />
      </ClientUsagePricingProvider>,
    );

    await waitFor(() => expect(screen.getByRole('columnheader', {name: 'Cost'})).toBeVisible());
    expect(screen.getByText('$1.20')).toBeVisible();
  });
});
