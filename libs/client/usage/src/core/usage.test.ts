import {
  groupInferenceSegmentsByStepAttempt,
  summarizeRunUsage,
  type UsageInferenceSegment,
  type UsageJobExecution,
} from './usage.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';

function segment(overrides: Partial<UsageInferenceSegment> = {}): UsageInferenceSegment {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    segmentKey: 'gateway:segment',
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
    requestCount: 1,
    inputTokens: 100,
    outputTokens: 50,
    cacheCreationTokens: 0,
    cacheReadTokens: 10,
    reasoningTokens: 5,
    webSearchRequests: 0,
    tokenClasses: {
      inputTokens: 100,
      cachedInputTokens: 10,
      cacheWriteTokens: 0,
      outputTokens: 50,
      totalTokens: 160,
      cacheHitRate: 10 / 110,
    },
    recordedAt: '2026-06-26T11:59:30.000Z',
    ...overrides,
  };
}

function execution(durationSeconds: number | null): UsageJobExecution {
  return {
    jobId: '22222222-2222-4222-8222-222222222222',
    jobExecutionId: '33333333-3333-4333-8333-333333333333',
    workflowRunId: RUN_ID,
    workflowRunAttemptId: '44444444-4444-4444-8444-444444444444',
    workspaceId: '55555555-5555-4555-8555-555555555555',
    projectId: '66666666-6666-4666-8666-666666666666',
    definitionId: null,
    jobKey: 'build',
    runNumber: 42,
    requestedLabels: null,
    runnerLabels: null,
    templateKey: null,
    provisionerId: null,
    provisionerScope: null,
    providerKind: null,
    launchKind: null,
    runnerClass: null,
    runnerArch: null,
    runnerCpu: null,
    managed: null,
    queuedAt: null,
    startedAt: null,
    finishedAt: null,
    leaseExpiredAt: null,
    status: null,
    statusReason: null,
    cancellationReason: null,
    durationSeconds,
    state: null,
    recordedAt: null,
  };
}

describe('Usage aggregation', () => {
  test('summarizes compute, total tokens, requests, and models', () => {
    const usage = {
      jobExecutions: [execution(12), execution(null), execution(8)],
      inferenceSegments: [
        segment(),
        segment({
          id: '77777777-7777-4777-8777-777777777777',
          model: 'gpt-5',
          requestCount: 2,
          inputTokens: 200,
          outputTokens: 25,
          tokenClasses: {
            inputTokens: 200,
            cachedInputTokens: 10,
            cacheWriteTokens: 0,
            outputTokens: 25,
            totalTokens: 235,
            cacheHitRate: 10 / 210,
          },
        }),
      ],
    };

    const summary = summarizeRunUsage(usage);

    expect(summary.computeSeconds).toBe(20);
    expect(summary.totals).toMatchObject({
      requestCount: 3,
      inputTokens: 300,
      outputTokens: 75,
      cachedInputTokens: 20,
      reasoningTokens: 10,
      totalTokens: 395,
      cacheHitRate: 20 / 320,
    });
    expect(summary.byModel.map(({model, totalTokens}) => [model, totalTokens])).toEqual([
      ['gpt-5', 235],
      ['claude-sonnet-4', 160],
    ]);
  });

  test('groups adjacent segments by step attempt, upstream, and model', () => {
    const rows = groupInferenceSegmentsByStepAttempt([
      segment(),
      segment({
        id: '77777777-7777-4777-8777-777777777777',
        requestCount: 2,
        inputTokens: 50,
        tokenClasses: {
          inputTokens: 50,
          cachedInputTokens: 10,
          cacheWriteTokens: 0,
          outputTokens: 50,
          totalTokens: 110,
          cacheHitRate: 10 / 60,
        },
      }),
      segment({
        id: '66666666-6666-4666-8666-666666666666',
        stepAttemptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      stepAttemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      requestCount: 3,
      inputTokens: 150,
      cachedInputTokens: 20,
      totalTokens: 270,
      cacheHitRate: 20 / 170,
    });
    expect(rows[1]).toMatchObject({
      stepAttemptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      requestCount: 1,
    });
  });

  test('keeps provider and model values containing separators distinct', () => {
    const rows = groupInferenceSegmentsByStepAttempt([
      segment({upstream: 'provider:one', model: 'model'}),
      segment({upstream: 'provider', model: 'one:model'}),
    ]);

    expect(rows.map(({upstream, model}) => [upstream, model])).toEqual([
      ['provider', 'one:model'],
      ['provider:one', 'model'],
    ]);
  });

  test('aggregates OpenAI counts from the shared token classes', () => {
    const rows = groupInferenceSegmentsByStepAttempt([
      segment({
        dialect: 'openai-responses',
        inputTokens: 100,
        outputTokens: 30,
        cacheReadTokens: 20,
        reasoningTokens: 9,
        tokenClasses: {
          inputTokens: 80,
          cachedInputTokens: 20,
          cacheWriteTokens: 0,
          outputTokens: 30,
          totalTokens: 130,
          cacheHitRate: 0.2,
        },
      }),
    ]);

    expect(rows[0]).toMatchObject({
      inputTokens: 80,
      cachedInputTokens: 20,
      cacheWriteTokens: 0,
      outputTokens: 30,
      totalTokens: 130,
      cacheHitRate: 0.2,
      reasoningTokens: 9,
    });
  });
});
