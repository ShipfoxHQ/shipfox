import {usageInterModuleContract} from './inter-module.js';
import {
  MAX_INFERENCE_SEGMENTS_BATCH_SIZE,
  MAX_STORAGE_SAMPLES_BATCH_SIZE,
  MAX_USAGE_REPLAY_LIMIT,
} from './schemas/usage.js';

const segmentInput = (segmentKey: string) => ({
  segmentKey,
  source: 'gateway' as const,
  workspaceId: crypto.randomUUID(),
  projectId: crypto.randomUUID(),
  workflowRunId: crypto.randomUUID(),
  workflowRunAttemptId: crypto.randomUUID(),
  jobId: crypto.randomUUID(),
  jobExecutionId: crypto.randomUUID(),
  stepId: crypto.randomUUID(),
  stepAttemptId: crypto.randomUUID(),
  upstream: 'openai',
  model: 'gpt-5',
  dialect: 'openai-responses' as const,
  windowStart: '2026-09-04T10:00:00.000Z',
  windowEnd: '2026-09-04T10:01:00.000Z',
  requestCount: 1,
  inputTokens: 1,
  outputTokens: 1,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  reasoningTokens: 0,
  webSearchRequests: 0,
});

describe('usageInterModuleContract', () => {
  it('bounds capture batches and applies the replay limit default', () => {
    const segments = Array.from({length: MAX_INFERENCE_SEGMENTS_BATCH_SIZE}, (_, index) =>
      segmentInput(`segment-${index}`),
    );
    const parsed = usageInterModuleContract.methods.recordInferenceSegments.input.parse({segments});
    expect(parsed.segments).toHaveLength(MAX_INFERENCE_SEGMENTS_BATCH_SIZE);

    expect(() =>
      usageInterModuleContract.methods.recordInferenceSegments.input.parse({
        segments: [...segments, segmentInput('segment-too-many')],
      }),
    ).toThrow();

    const replayInput = usageInterModuleContract.methods.listInferenceSegments.input.parse({});
    expect(replayInput.limit).toBe(MAX_USAGE_REPLAY_LIMIT);
  });

  it('requires replay cursors to carry both the timestamp and tie-breaker id', () => {
    const parsed = usageInterModuleContract.methods.listJobExecutionUsage.input.parse({
      cursor: {
        recordedAt: '2026-09-04T10:00:00.000Z',
        jobExecutionId: crypto.randomUUID(),
      },
      limit: 10,
    });
    expect(parsed.cursor?.recordedAt).toBe('2026-09-04T10:00:00.000Z');
    expect(() =>
      usageInterModuleContract.methods.listJobExecutionUsage.input.parse({
        cursor: {recordedAt: '2026-09-04T10:00:00.000Z'},
      }),
    ).toThrow();
  });
});

describe('storage samples', () => {
  const sampleInput = (sampleKey: string) => ({
    sampleKey,
    source: 'cache' as const,
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    windowStart: '2026-10-13T10:00:00.000Z',
    windowEnd: '2026-10-13T11:00:00.000Z',
    storedBytes: 1_024,
    objectCount: 2,
  });

  it('bounds record batches and applies the replay limit default', () => {
    const samples = Array.from({length: MAX_STORAGE_SAMPLES_BATCH_SIZE}, (_, index) =>
      sampleInput(`cache:${index}`),
    );
    const parsed = usageInterModuleContract.methods.recordStorageSamples.input.parse({samples});
    expect(parsed.samples).toHaveLength(MAX_STORAGE_SAMPLES_BATCH_SIZE);
    expect(() =>
      usageInterModuleContract.methods.recordStorageSamples.input.parse({
        samples: [...samples, sampleInput('cache:too-many')],
      }),
    ).toThrow();
    expect(usageInterModuleContract.methods.listStorageSamples.input.parse({}).limit).toBe(
      MAX_USAGE_REPLAY_LIMIT,
    );
  });

  it('accepts only a whole clock hour', () => {
    const input = usageInterModuleContract.methods.recordStorageSamples.input;
    expect(() =>
      input.parse({samples: [{...sampleInput('a'), windowStart: '2026-10-13T10:05:00.000Z'}]}),
    ).toThrow();
    expect(() =>
      input.parse({samples: [{...sampleInput('a'), windowEnd: '2026-10-13T10:30:00.000Z'}]}),
    ).toThrow();
  });

  it('carries quantities only', () => {
    expect(() =>
      usageInterModuleContract.methods.recordStorageSamples.input.parse({
        samples: [{...sampleInput('a'), amount: 1}],
      }),
    ).toThrow();
  });
});
