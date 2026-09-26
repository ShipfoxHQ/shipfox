import {
  shipfoxJobCompletedEventPayloadSchema,
  shipfoxJobQueuedEventPayloadSchema,
  shipfoxJobStartedEventPayloadSchema,
  shipfoxRunCompletedEventPayloadSchema,
  shipfoxRunRequestedEventPayloadSchema,
  shipfoxRunStartedEventPayloadSchema,
} from './index.js';

const identity = {
  project: {id: '0198a100-0000-7000-8000-000000000001', name: 'api'},
  workflow: {
    id: '0198a100-0000-7000-8000-000000000002',
    name: 'Build',
    path: '.shipfox/workflows/build.yml',
  },
  run: {
    id: '0198a100-0000-7000-8000-000000000003',
    number: 42,
    attempt: 1,
    name: 'Build',
    origin: 'synced' as const,
    trigger: {source: 'github', event: 'push'},
    ref: 'refs/heads/main',
    commit: '9f2c000000000000000000000000000000000000',
    parent_run_id: null,
    root_run_id: null,
    created_at: '2026-09-26T10:00:00Z',
  },
};

const job = {
  id: '0198a100-0000-7000-8000-000000000004',
  key: 'deploy',
  mode: 'one_shot' as const,
  execution: {
    id: '0198a100-0000-7000-8000-000000000005',
    sequence: 1,
  },
};

describe('Shipfox event payload schemas', () => {
  it('parses run.requested for a waiting run', () => {
    const result = shipfoxRunRequestedEventPayloadSchema.safeParse({
      ...identity,
      run: {...identity.run, status: 'waiting'},
    });

    expect(result.success).toBe(true);
  });

  it('parses run.started', () => {
    const result = shipfoxRunStartedEventPayloadSchema.safeParse({
      ...identity,
      run: {...identity.run, status: 'running', started_at: '2026-09-26T10:01:00Z'},
    });

    expect(result.success).toBe(true);
  });

  it('parses run.completed without a start or workflow outputs', () => {
    const result = shipfoxRunCompletedEventPayloadSchema.safeParse({
      ...identity,
      run: {
        ...identity.run,
        ref: null,
        commit: null,
        status: 'cancelled',
        status_reason: 'user_cancelled',
        started_at: null,
        finished_at: '2026-09-26T10:02:00Z',
        outputs: null,
      },
    });

    expect(result.success).toBe(true);
  });

  it('parses job.queued', () => {
    const result = shipfoxJobQueuedEventPayloadSchema.safeParse({
      ...identity,
      job: {...job, status: 'pending', queued_at: '2026-09-26T10:01:00Z'},
    });

    expect(result.success).toBe(true);
  });

  it('parses job.started with runner labels', () => {
    const result = shipfoxJobStartedEventPayloadSchema.safeParse({
      ...identity,
      job: {
        ...job,
        status: 'running',
        runner_labels: ['linux', 'x64'],
        started_at: '2026-09-26T10:01:01Z',
      },
    });

    expect(result.success).toBe(true);
  });

  it('parses job.completed with null outputs', () => {
    const result = shipfoxJobCompletedEventPayloadSchema.safeParse({
      ...identity,
      job: {
        ...job,
        status: 'failed',
        status_reason: 'step_failed',
        finished_at: '2026-09-26T10:02:00Z',
        outputs: null,
      },
    });

    expect(result.success).toBe(true);
  });
});
