import type {RunnerJobClaimedEvent, RunnerJobLeaseExpiredEvent} from '@shipfox/api-runners-dto';
import {inferenceSegmentUsageHttpSchema} from '@shipfox/api-usage-dto';
import type {
  WorkflowsJobExecutionQueuedEventDto,
  WorkflowsJobExecutionTerminatedEventDto,
} from '@shipfox/api-workflows-dto';
import {eq, sql} from 'drizzle-orm';
import {toInferenceSegmentUsageDto} from '#presentation/dto.js';
import {db} from './db.js';
import {
  listInferenceSegments,
  recordInferenceSegments,
  toInferenceSegmentUsage,
} from './inference-segments.js';
import {
  getJobExecutionUsage,
  listJobExecutionUsage,
  recordJobExecutionClaimed,
  recordJobExecutionLeaseExpired,
  recordJobExecutionQueued,
  recordJobExecutionTerminated,
} from './job-executions.js';
import {dropExpiredUsagePartitions} from './retention.js';
import {usageOutbox} from './schema/outbox.js';
import {listStorageSamples, recordStorageSamples} from './storage-samples.js';

const jobExecutionPartitionPattern = /^usage_job_executions_\d{4}_\d{2}$/;
const monthlyPartitionPattern =
  /usage_(job_executions|inference_segments|storage_samples)_\d{4}_\d{2}/;

interface JobEventSet {
  queued: WorkflowsJobExecutionQueuedEventDto;
  claimed: RunnerJobClaimedEvent;
  leaseExpired: RunnerJobLeaseExpiredEvent;
  terminated: WorkflowsJobExecutionTerminatedEventDto;
}

function jobEvents(): JobEventSet {
  const workspaceId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const workflowRunId = crypto.randomUUID();
  const workflowRunAttemptId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const jobExecutionId = crypto.randomUUID();
  const definitionId = crypto.randomUUID();
  const workflowId = definitionId;
  const workflowName = 'Deploy';
  const queuedAt = '2026-09-04T10:00:00.000Z';
  const startedAt = '2026-09-04T10:00:01.000Z';
  const finishedAt = '2026-09-04T10:00:11.000Z';

  return {
    queued: {
      workspaceId,
      projectId,
      workflowRunId,
      workflowRunAttemptId,
      jobId,
      jobExecutionId,
      definitionId,
      workflowId,
      workflowName,
      jobKey: 'build',
      runNumber: 2,
      requiredLabels: ['linux'],
      queuedAt,
    },
    claimed: {
      workspaceId,
      projectId,
      workflowRunId,
      workflowRunAttemptId,
      jobId,
      jobExecutionId,
      claimedAt: startedAt,
      runnerLabels: ['arch.x64', 'class.standard', 'cpu.2', 'linux', 'shipfox-managed'],
      templateKey: 'standard',
      provisionerId: crypto.randomUUID(),
      provisionerScope: 'installation',
      providerKind: 'aws',
      launchKind: 'demand',
    },
    leaseExpired: {
      workflowRunId,
      workflowRunAttemptId,
      jobId,
      jobExecutionId,
      expiredAt: '2026-09-04T10:00:05.000Z',
    },
    terminated: {
      workspaceId,
      projectId,
      definitionId,
      workflowId,
      workflowName,
      jobKey: 'build',
      workflowRunId,
      workflowRunAttemptId,
      jobId,
      jobExecutionId,
      status: 'succeeded',
      statusReason: null,
      cancellationReason: null,
      finishedAt,
      startedAt,
      queuedAt,
      runnerLabels: ['arch.x64', 'class.standard', 'cpu.2', 'linux', 'shipfox-managed'],
      templateKey: 'standard',
      provisionerId: null,
      provisionerScope: 'installation',
      providerKind: 'aws',
      launchKind: 'demand',
    },
  };
}

function inferenceSegment(
  identity?: Pick<
    WorkflowsJobExecutionQueuedEventDto,
    | 'workspaceId'
    | 'projectId'
    | 'workflowRunId'
    | 'workflowRunAttemptId'
    | 'jobId'
    | 'jobExecutionId'
  >,
) {
  return {
    segmentKey: `gateway:${crypto.randomUUID()}`,
    source: 'gateway' as const,
    workspaceId: identity?.workspaceId ?? crypto.randomUUID(),
    projectId: identity?.projectId ?? crypto.randomUUID(),
    workflowRunId: identity?.workflowRunId ?? crypto.randomUUID(),
    workflowRunAttemptId: identity?.workflowRunAttemptId ?? crypto.randomUUID(),
    jobId: identity?.jobId ?? crypto.randomUUID(),
    jobExecutionId: identity?.jobExecutionId ?? crypto.randomUUID(),
    stepId: crypto.randomUUID(),
    stepAttemptId: crypto.randomUUID(),
    upstream: 'openai',
    model: 'gpt-5',
    dialect: 'openai-responses' as const,
    windowStart: '2026-09-04T10:00:00.000Z',
    windowEnd: '2026-09-04T10:01:00.000Z',
    requestCount: 2,
    inputTokens: 10,
    outputTokens: 20,
    cacheCreationTokens: 0,
    cacheReadTokens: 4,
    reasoningTokens: 6,
    webSearchRequests: 3,
  };
}

function storageSample(
  overrides: {projectId?: string; windowStart?: string; windowEnd?: string} = {},
) {
  const projectId = overrides.projectId ?? crypto.randomUUID();
  const windowStart = overrides.windowStart ?? '2026-10-13T10:00:00.000Z';
  return {
    sampleKey: `cache:${projectId}:${windowStart}`,
    source: 'cache' as const,
    workspaceId: crypto.randomUUID(),
    projectId,
    windowStart,
    windowEnd: overrides.windowEnd ?? '2026-10-13T11:00:00.000Z',
    storedBytes: 5_000_000_000,
    objectCount: 4,
  };
}

async function outboxFor(eventType: string, field: 'jobExecutionId' | 'segmentKey', value: string) {
  const rows = await db().select().from(usageOutbox).where(eq(usageOutbox.eventType, eventType));
  return rows.filter((row) => {
    const payload = row.payload as Record<string, unknown>;
    return payload[field] === value;
  });
}

describe('Usage projections', () => {
  it.each([
    [
      'queued, claimed, lease expiry, terminated',
      ['queued', 'claimed', 'leaseExpired', 'terminated'],
    ],
    [
      'claimed, queued, terminated, lease expiry',
      ['claimed', 'queued', 'terminated', 'leaseExpired'],
    ],
    [
      'lease expiry, terminated, queued, claimed',
      ['leaseExpired', 'terminated', 'queued', 'claimed'],
    ],
  ] as const)('converges for the %s arrival order', async (_name, order) => {
    const events = jobEvents();
    const steps = {
      queued: () => recordJobExecutionQueued(events.queued),
      claimed: () => recordJobExecutionClaimed(events.claimed),
      leaseExpired: () => recordJobExecutionLeaseExpired(events.leaseExpired),
      terminated: () => recordJobExecutionTerminated(events.terminated),
    };

    for (const step of order) await steps[step]();

    const row = await getJobExecutionUsage({
      workspaceId: events.queued.workspaceId,
      jobExecutionId: events.queued.jobExecutionId,
    });
    expect(row).not.toBeNull();
    expect(row?.state).toBe('terminated');
    expect(row?.status).toBe('succeeded');
    expect(row?.runnerClass).toBe('standard');
    expect(row?.runnerArch).toBe('x64');
    expect(row?.runnerCpu).toBe('2');
    expect(row?.managed).toBe(true);
    expect(row?.leaseExpiredAt?.toISOString()).toBe('2026-09-04T10:00:05.000Z');
    expect(row?.durationSeconds).toBe(10);
    expect(row?.workflowId).toBe(events.queued.workflowId);
    expect(row?.workflowName).toBe(events.queued.workflowName);
    const recordedEvents = await outboxFor(
      'usage.job_execution.recorded',
      'jobExecutionId',
      events.queued.jobExecutionId,
    );
    expect(recordedEvents).toHaveLength(1);
    expect(recordedEvents[0]?.payload).toMatchObject({
      workflowId: events.queued.workflowId,
      workflowName: events.queued.workflowName,
    });

    const duplicate = await recordJobExecutionTerminated(events.terminated);
    expect(duplicate.published).toBe(false);
    expect(
      await outboxFor(
        'usage.job_execution.recorded',
        'jobExecutionId',
        events.queued.jobExecutionId,
      ),
    ).toHaveLength(1);
  });

  it('serializes concurrent terminal deliveries and publishes one durable snapshot', async () => {
    const events = jobEvents();
    await recordJobExecutionQueued(events.queued);
    const results = await Promise.all([
      recordJobExecutionTerminated(events.terminated),
      recordJobExecutionTerminated(events.terminated),
    ]);

    expect(results.filter((result) => result.published)).toHaveLength(1);
    expect(
      await outboxFor(
        'usage.job_execution.recorded',
        'jobExecutionId',
        events.terminated.jobExecutionId,
      ),
    ).toHaveLength(1);
  });

  it('defers terminal publication until the queued projection fills its fields', async () => {
    const events = jobEvents();

    await expect(recordJobExecutionTerminated(events.terminated)).resolves.toMatchObject({
      published: false,
      deferred: true,
    });
    expect(
      await outboxFor(
        'usage.job_execution.recorded',
        'jobExecutionId',
        events.terminated.jobExecutionId,
      ),
    ).toHaveLength(0);

    await expect(recordJobExecutionQueued(events.queued)).resolves.toMatchObject({
      published: true,
      deferred: false,
    });
    const row = await getJobExecutionUsage({
      workspaceId: events.queued.workspaceId,
      jobExecutionId: events.queued.jobExecutionId,
    });
    expect(row).toMatchObject({requestedLabels: ['linux'], runNumber: 2, state: 'terminated'});
    expect(
      await outboxFor(
        'usage.job_execution.recorded',
        'jobExecutionId',
        events.terminated.jobExecutionId,
      ),
    ).toHaveLength(1);
  });

  it('defers legacy terminal events that omit queuedAt', async () => {
    const events = jobEvents();
    const legacyTerminated = {...events.terminated, queuedAt: undefined};

    await expect(recordJobExecutionTerminated(legacyTerminated)).resolves.toMatchObject({
      published: false,
      deferred: true,
    });
    await expect(recordJobExecutionQueued(events.queued)).resolves.toMatchObject({
      published: true,
    });
  });

  it('recomputes duration when a late claim supplies the missing start time', async () => {
    const events = jobEvents();
    events.terminated.startedAt = null;

    await recordJobExecutionTerminated(events.terminated);
    expect(
      (
        await getJobExecutionUsage({
          workspaceId: events.queued.workspaceId,
          jobExecutionId: events.terminated.jobExecutionId,
        })
      )?.durationSeconds,
    ).toBeNull();

    await recordJobExecutionClaimed(events.claimed);
    const row = await getJobExecutionUsage({
      workspaceId: events.queued.workspaceId,
      jobExecutionId: events.terminated.jobExecutionId,
    });
    expect(row?.startedAt?.toISOString()).toBe(events.claimed.claimedAt);
    expect(row?.durationSeconds).toBe(10);
  });

  it('does not record an inference segment before its job identity is projected', async () => {
    const events = jobEvents();
    const segment = inferenceSegment(events.queued);

    await expect(recordInferenceSegments({segments: [segment]})).rejects.toThrow(
      'Usage job execution is not projected',
    );
    await recordJobExecutionQueued(events.queued);

    await expect(recordInferenceSegments({segments: [segment]})).resolves.toEqual({
      recorded: 1,
      duplicates: 0,
    });
    const [recorded] = (
      await listInferenceSegments({
        workspaceId: events.queued.workspaceId,
        limit: 1,
      })
    ).segments;
    expect(recorded).toMatchObject({
      workflowId: events.queued.workflowId,
      workflowName: events.queued.workflowName,
    });
  });

  it('records inference segments idempotently and exposes replay cursors', async () => {
    const events = jobEvents();
    const secondEvents = jobEvents();
    secondEvents.queued.workspaceId = events.queued.workspaceId;
    const first = inferenceSegment(events.queued);
    const second = inferenceSegment(secondEvents.queued);
    const recordedAt = new Date('2026-09-04T10:05:00.000Z');
    const workspaceId = events.queued.workspaceId;

    await recordJobExecutionQueued(events.queued);
    await recordJobExecutionQueued(secondEvents.queued);
    await expect(
      recordInferenceSegments({segments: [first, second], now: recordedAt}),
    ).resolves.toEqual({
      recorded: 2,
      duplicates: 0,
    });
    await expect(recordInferenceSegments({segments: [first], now: recordedAt})).resolves.toEqual({
      recorded: 0,
      duplicates: 1,
    });
    expect(
      await outboxFor('usage.inference_segment.recorded', 'segmentKey', first.segmentKey),
    ).toHaveLength(1);

    const page = await listInferenceSegments({workspaceId, limit: 1});
    expect(page.segments).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const cursor = page.nextCursor;
    if (!cursor) throw new Error('Expected an inference replay cursor');
    const nextPage = await listInferenceSegments({workspaceId, cursor, limit: 1});
    expect(nextPage.segments).toHaveLength(1);
    expect(nextPage.nextCursor).toBeNull();
    const firstSegment = page.segments[0];
    if (!firstSegment) throw new Error('Expected a first inference segment');
    expect(toInferenceSegmentUsage(firstSegment)).toMatchObject({
      workspaceId,
      workflowId: events.queued.workflowId,
      workflowName: events.queued.workflowName,
      webSearchRequests: 3,
    });
    expect(toInferenceSegmentUsageDto(firstSegment)).toMatchObject({
      web_search_requests: 3,
    });
    expect(toInferenceSegmentUsageDto(firstSegment)).not.toHaveProperty('upstream');
    const {web_search_requests: webSearchRequests, ...legacyHttpDto} =
      toInferenceSegmentUsageDto(firstSegment);
    void webSearchRequests;
    expect(inferenceSegmentUsageHttpSchema.parse(legacyHttpDto)).toMatchObject({
      web_search_requests: 0,
    });

    const boundaryEvents = jobEvents();
    const boundarySegment = inferenceSegment(boundaryEvents.queued);
    boundarySegment.webSearchRequests = 2_147_483_647;
    await recordJobExecutionQueued(boundaryEvents.queued);
    await expect(
      recordInferenceSegments({segments: [boundarySegment], now: recordedAt}),
    ).resolves.toEqual({recorded: 1, duplicates: 0});
    const boundaryPage = await listInferenceSegments({
      workspaceId: boundaryEvents.queued.workspaceId,
      limit: 1,
    });
    const persistedBoundarySegment = boundaryPage.segments[0];
    if (!persistedBoundarySegment) throw new Error('Expected the boundary inference segment');
    expect(toInferenceSegmentUsage(persistedBoundarySegment).webSearchRequests).toBe(2_147_483_647);
  });

  it('replays terminal job executions by a stable timestamp and id cursor', async () => {
    const first = jobEvents();
    const second = jobEvents();
    second.queued.workspaceId = first.queued.workspaceId;
    second.queued.projectId = first.queued.projectId;
    second.terminated.workspaceId = first.terminated.workspaceId;
    second.terminated.projectId = first.terminated.projectId;
    await recordJobExecutionQueued(first.queued);
    await recordJobExecutionQueued(second.queued);
    await Promise.all([
      recordJobExecutionTerminated(first.terminated),
      recordJobExecutionTerminated(second.terminated),
    ]);

    const page = await listJobExecutionUsage({workspaceId: first.queued.workspaceId, limit: 1});
    expect(page.jobExecutions).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const cursor = page.nextCursor;
    if (!cursor) throw new Error('Expected a job execution replay cursor');
    const nextPage = await listJobExecutionUsage({
      workspaceId: first.queued.workspaceId,
      cursor,
      limit: 1,
    });
    expect(nextPage.jobExecutions).toHaveLength(1);
    expect(nextPage.nextCursor).toBeNull();
  });

  it('records storage samples idempotently and publishes one event per sample', async () => {
    const sample = storageSample();

    await expect(recordStorageSamples({samples: [sample]})).resolves.toEqual({
      recorded: 1,
      duplicates: 0,
    });
    await expect(recordStorageSamples({samples: [sample, sample]})).resolves.toEqual({
      recorded: 0,
      duplicates: 2,
    });

    const {samples} = await listStorageSamples({workspaceId: sample.workspaceId});
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      sampleKey: sample.sampleKey,
      projectId: sample.projectId,
      storedBytes: 5_000_000_000,
      objectCount: 4,
    });
    const events = await db()
      .select()
      .from(usageOutbox)
      .where(eq(usageOutbox.eventType, 'usage.storage_sample.recorded'));
    expect(
      events.filter((row) => (row.payload as {sampleKey: string}).sampleKey === sample.sampleKey),
    ).toHaveLength(1);
  });

  it('counts a repeated key inside one batch as a duplicate', async () => {
    const sample = storageSample();
    await expect(recordStorageSamples({samples: [sample, sample]})).resolves.toEqual({
      recorded: 1,
      duplicates: 1,
    });
  });

  it('records a new sample for each hour of a project', async () => {
    const first = storageSample();
    const second = storageSample({
      projectId: first.projectId,
      windowStart: '2026-10-13T11:00:00.000Z',
      windowEnd: '2026-10-13T12:00:00.000Z',
    });
    await expect(
      recordStorageSamples({samples: [first, {...second, workspaceId: first.workspaceId}]}),
    ).resolves.toEqual({recorded: 2, duplicates: 0});
  });

  it('replays storage samples by a stable timestamp and id cursor', async () => {
    const workspaceId = crypto.randomUUID();
    const samples = [storageSample(), storageSample()].map((sample) => ({...sample, workspaceId}));
    await recordStorageSamples({samples});

    const page = await listStorageSamples({workspaceId, limit: 1});
    expect(page.samples).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const cursor = page.nextCursor;
    if (!cursor) throw new Error('Expected a storage sample replay cursor');
    const nextPage = await listStorageSamples({workspaceId, cursor, limit: 1});
    expect(nextPage.samples).toHaveLength(1);
    expect(nextPage.nextCursor).toBeNull();
    expect(nextPage.samples[0]?.id).not.toBe(page.samples[0]?.id);
  });

  it('creates monthly range children on demand and drops only expired complete months', async () => {
    const sample = (month: string) =>
      storageSample({
        windowStart: `${month}-15T10:00:00.000Z`,
        windowEnd: `${month}-15T11:00:00.000Z`,
      });
    const events = jobEvents();
    await recordJobExecutionQueued(events.queued);
    await recordJobExecutionTerminated(events.terminated);
    const january = inferenceSegment(events.queued);
    const february = inferenceSegment(events.queued);
    await recordInferenceSegments({
      segments: [january],
      now: new Date('2020-01-15T00:00:00.000Z'),
    });
    await recordInferenceSegments({
      segments: [february],
      now: new Date('2020-02-15T00:00:00.000Z'),
    });
    await recordStorageSamples({
      samples: [sample('2020-01')],
      now: new Date('2020-01-15T00:00:00.000Z'),
    });
    await recordStorageSamples({
      samples: [sample('2020-02')],
      now: new Date('2020-02-15T00:00:00.000Z'),
    });

    const provisioned = await dropExpiredUsagePartitions({
      retentionDays: 100_000,
      now: new Date('2020-03-02T00:00:00.000Z'),
    });
    expect(provisioned.dropped).toBe(0);
    const placement = await db().execute(sql`
      select tableoid::regclass::text as name
      from usage_inference_segments
      where segment_key in (${january.segmentKey}, ${february.segmentKey})
      order by recorded_at
    `);
    expect(placement.rows.map((row) => row.name)).toEqual([
      'usage_inference_segments_2020_01',
      'usage_inference_segments_2020_02',
    ]);
    const jobPlacement = await db().execute(sql`
      select tableoid::regclass::text as name
      from usage_job_executions
      where job_execution_id = ${events.terminated.jobExecutionId}
    `);
    expect(jobPlacement.rows[0]?.name).toMatch(jobExecutionPartitionPattern);

    const result = await dropExpiredUsagePartitions({
      retentionDays: 29,
      now: new Date('2020-03-02T00:00:00.000Z'),
    });
    expect(result.partitions).toEqual(
      expect.arrayContaining(['usage_inference_segments_2020_01', 'usage_storage_samples_2020_01']),
    );
    expect(result.partitions).not.toContain('usage_inference_segments_2020_02');
    expect(result.partitions).not.toContain('usage_storage_samples_2020_02');
    expect(result.partitions.every((name) => monthlyPartitionPattern.test(name))).toBe(true);
    await expect(
      getJobExecutionUsage({
        workspaceId: events.queued.workspaceId,
        jobExecutionId: events.terminated.jobExecutionId,
      }),
    ).resolves.not.toBeNull();
  });
});
