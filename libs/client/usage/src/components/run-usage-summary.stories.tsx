import {
  type ClientUsagePricing,
  ClientUsagePricingProvider,
  type UsagePricingCost,
} from '@shipfox/client-shell/runtime';
import type {Meta, StoryObj} from '@storybook/react';
import {expect, userEvent, waitFor, within} from 'storybook/test';
import type {RunUsage} from '#core/usage.js';
import {RunUsageSummary} from './run-usage-summary.js';
import {UsageDetails} from './usage-details.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';

const usage: RunUsage = {
  jobExecutions: [
    {
      jobId: '22222222-2222-4222-8222-222222222222',
      jobExecutionId: '33333333-3333-4333-8333-333333333333',
      workflowRunId: RUN_ID,
      workflowRunAttemptId: '44444444-4444-4444-8444-444444444444',
      workspaceId: '55555555-5555-4555-8555-555555555555',
      projectId: '66666666-6666-4666-8666-666666666666',
      definitionId: '77777777-7777-4777-8777-777777777777',
      jobKey: 'build',
      runNumber: 42,
      requestedLabels: ['linux'],
      runnerLabels: ['linux', 'x86_64'],
      templateKey: 'ubuntu',
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
    },
  ],
  inferenceSegments: [
    {
      id: '88888888-8888-4888-8888-888888888888',
      segmentKey: 'gateway:build:1',
      source: 'gateway',
      workspaceId: '55555555-5555-4555-8555-555555555555',
      projectId: '66666666-6666-4666-8666-666666666666',
      workflowRunId: RUN_ID,
      workflowRunAttemptId: '44444444-4444-4444-8444-444444444444',
      jobId: '22222222-2222-4222-8222-222222222222',
      jobExecutionId: '33333333-3333-4333-8333-333333333333',
      stepId: '99999999-9999-4999-8999-999999999999',
      stepAttemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
    },
  ],
};

const pricing: ClientUsagePricing = {
  resolveCosts: (refs) =>
    new Map(
      refs.map((reference) => [
        `${reference.kind}:${reference.id}`,
        {amount: 0.42, state: 'resolved'},
      ]),
    ),
  estimate: () => ({amount: 0.42, state: 'estimated'}),
  formatMoney: (amount) => `$${amount.toFixed(2)}`,
};

const meta = {
  title: 'Usage/RunUsageSummary',
  component: RunUsageSummary,
  parameters: {layout: 'padded'},
} satisfies Meta<typeof RunUsageSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithoutPricing: Story = {
  args: {runId: RUN_ID, usage},
};

export const WithPricing: Story = {
  args: {runId: RUN_ID, usage},
  decorators: [
    (Story) => (
      <ClientUsagePricingProvider usagePricing={pricing}>
        <Story />
      </ClientUsagePricingProvider>
    ),
  ],
};

const detailedCost: UsagePricingCost = {
  amount: 0.42,
  state: 'resolved',
  breakdown: {
    machine: {amount: 0.12, state: 'resolved'},
    modelUsage: {amount: 0.3, state: 'resolved'},
    models: [
      {
        model: 'claude-sonnet-4',
        upstream: 'anthropic',
        cost: {amount: 0.3, state: 'resolved'},
        skus: [
          {
            sku: 'input',
            label: 'Input tokens',
            quantity: 1200,
            unit: 'tokens',
            rate: '$100.00 / 1M tokens',
            cost: {amount: 0.12, state: 'resolved'},
          },
          {
            sku: 'cached-input',
            label: 'Cached input tokens',
            quantity: 100,
            unit: 'tokens',
            rate: '$100.00 / 1M tokens',
            cost: {amount: 0.01, state: 'resolved'},
          },
          {
            sku: 'output',
            label: 'Output tokens',
            quantity: 500,
            unit: 'tokens',
            rate: '$300.00 / 1M tokens',
            cost: {amount: 0.15, state: 'resolved'},
          },
          {
            sku: 'web-search',
            label: 'Web searches',
            quantity: 2,
            unit: 'searches',
            rate: '$10.00 / 1K searches',
            cost: {amount: 0.02, state: 'resolved'},
          },
        ],
      },
    ],
  },
};

export const CostBreakdown: Story = {
  args: {runId: RUN_ID, usage},
  render: () => (
    <ClientUsagePricingProvider usagePricing={pricing}>
      <UsageDetails scope="Run" usage={usage} cost={detailedCost} defaultOpen />
    </ClientUsagePricingProvider>
  ),
};

export const UsageWithoutPricing: Story = {
  args: {runId: RUN_ID, usage},
  render: () => <UsageDetails scope="Run" usage={usage} cost={undefined} defaultOpen />,
};

export const TestSkuDrillDown: Story = {
  ...CostBreakdown,
  play: async ({canvasElement}) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(body.getByText('Model usage'));
    await userEvent.click(body.getByText('claude-sonnet-4'));
    await expect(body.getByText('Output tokens')).toBeVisible();
    await expect(body.getByText('500 tokens · $300.00 / 1M tokens')).toBeVisible();
  },
};

export const TestMobileSkuDrillDown: Story = {
  ...TestSkuDrillDown,
  parameters: {
    viewport: {
      defaultViewport: 'mobile',
      viewports: {
        mobile: {name: 'Mobile', styles: {width: '390px', height: '844px'}, type: 'mobile'},
      },
    },
  },
};

export const TestKeyboardDismissal: Story = {
  ...WithPricing,
  play: async ({canvasElement}) => {
    const body = within(canvasElement.ownerDocument.body);
    const trigger = await body.findByRole('button', {name: 'View run cost details'});
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(body.getByRole('dialog', {name: 'Run cost'})).toBeVisible());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};
