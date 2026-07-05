import {DEFINITION_RESOLVED, definitionsEventSchemas} from '@shipfox/api-definitions-dto';
import type {DrainAllResult, DrainedEvent} from '@shipfox/node-module';
import type {DomainEvent} from '@shipfox/node-outbox';
import {drainAndDispatch} from './drain-and-dispatch.js';

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  drainAll: vi.fn(),
  getEventSchema: vi.fn(),
  getSubscribers: vi.fn(),
  markDispatched: vi.fn(),
  recordDispatchFailure: vi.fn(),
  errorLog: vi.fn(),
  warnLog: vi.fn(),
  eventDispatchedAdd: vi.fn(),
  dispatchFailureAdd: vi.fn(),
  drainBatchRecord: vi.fn(),
}));

vi.mock('@shipfox/node-error-monitoring', () => ({
  captureException: mocks.captureException,
}));

vi.mock('@shipfox/node-module', async () => {
  const actual =
    await vi.importActual<typeof import('@shipfox/node-module')>('@shipfox/node-module');
  return {
    ...actual,
    drainAll: mocks.drainAll,
    getEventSchema: mocks.getEventSchema,
    getSubscribers: mocks.getSubscribers,
    markDispatched: mocks.markDispatched,
    recordDispatchFailure: mocks.recordDispatchFailure,
  };
});

vi.mock('@shipfox/node-opentelemetry', () => ({
  instanceMetrics: {
    getMeter: () => ({
      createCounter: (name: string) => {
        if (name === 'dispatcher_event_dispatched') return {add: mocks.eventDispatchedAdd};
        if (name === 'dispatcher_dispatch_failure') return {add: mocks.dispatchFailureAdd};
        throw new Error(`Unexpected counter: ${name}`);
      },
      createHistogram: (name: string) => {
        if (name === 'dispatcher_drain_batch') return {record: mocks.drainBatchRecord};
        throw new Error(`Unexpected histogram: ${name}`);
      },
    }),
  },
  logger: () => ({
    error: mocks.errorLog,
    warn: mocks.warnLog,
  }),
}));

function drain(events: DrainedEvent[], hasMore = false): DrainAllResult {
  return {events, hasMore};
}

function event(id: string, createdAt: Date): DomainEvent {
  return {
    id,
    type: 'workflows.job.terminated',
    createdAt,
    payload: {jobId: id, workflowRunId: 'run-1', status: 'succeeded'},
  };
}

describe('drainAndDispatch', () => {
  beforeEach(() => {
    mocks.captureException.mockReset();
    mocks.drainAll.mockReset();
    mocks.getEventSchema.mockReset();
    mocks.getSubscribers.mockReset();
    mocks.markDispatched.mockReset();
    mocks.recordDispatchFailure.mockReset();
    mocks.errorLog.mockReset();
    mocks.warnLog.mockReset();
    mocks.eventDispatchedAdd.mockReset();
    mocks.dispatchFailureAdd.mockReset();
    mocks.drainBatchRecord.mockReset();
  });

  it('records an empty drain batch tick', async () => {
    mocks.drainAll.mockResolvedValueOnce(drain([]));

    const hasMore = await drainAndDispatch();

    expect(mocks.drainBatchRecord).toHaveBeenCalledWith(0);
    expect(hasMore).toBe(false);
    expect(mocks.eventDispatchedAdd).not.toHaveBeenCalled();
    expect(mocks.dispatchFailureAdd).not.toHaveBeenCalled();
  });

  it('returns hasMore from drainAll', async () => {
    mocks.drainAll.mockResolvedValueOnce(drain([], true));

    const hasMore = await drainAndDispatch();

    expect(hasMore).toBe(true);
  });

  it('logs sanitized context, captures failed subscriber exceptions, and records a row failure', async () => {
    const failure = new Error('subscriber failed');
    const rowId = crypto.randomUUID();
    const event: DomainEvent = {
      id: crypto.randomUUID(),
      type: 'projects.project.source_bound',
      createdAt: new Date(),
      payload: {
        projectId: crypto.randomUUID(),
        workspaceId: crypto.randomUUID(),
      },
    };
    mocks.drainAll.mockResolvedValueOnce(
      drain([{id: rowId, source: 'projects', orderingKey: 'projects', event}]),
    );
    mocks.getSubscribers.mockReturnValueOnce([vi.fn().mockRejectedValueOnce(failure)]);

    await drainAndDispatch();

    expect(mocks.errorLog).toHaveBeenCalledWith(
      {
        err: failure,
        kind: 'handler',
        eventType: event.type,
        eventId: rowId,
        errorName: 'Error',
        errorMessage: 'subscriber failed',
      },
      'Handler failed for outbox event',
    );
    expect(mocks.captureException).toHaveBeenCalledWith(failure, {
      extra: {
        kind: 'handler',
        eventType: event.type,
        eventId: rowId,
        errorName: 'Error',
        errorMessage: 'subscriber failed',
      },
    });
    expect(mocks.recordDispatchFailure).toHaveBeenCalledWith('projects', rowId, {
      kind: 'handler',
      eventType: event.type,
      eventId: rowId,
      errorName: 'Error',
      errorMessage: 'subscriber failed',
    });
    expect(mocks.eventDispatchedAdd).toHaveBeenCalledWith(1, {
      module: 'projects',
      outcome: 'failed',
    });
    expect(mocks.dispatchFailureAdd).toHaveBeenCalledWith(1, {
      module: 'projects',
      reason: 'handler',
    });
    expect(mocks.markDispatched).not.toHaveBeenCalled();
  });

  it('returns hasMore after group-level persistence failures', async () => {
    const success = event('success', new Date('2026-01-01T00:00:00.000Z'));
    const other = event('other', new Date('2026-01-01T00:00:00.000Z'));
    mocks.drainAll.mockResolvedValueOnce(
      drain(
        [
          {id: success.id, source: 'workflows', orderingKey: 'run-1', event: success},
          {id: other.id, source: 'integrations', orderingKey: 'integrations', event: other},
        ],
        true,
      ),
    );
    mocks.getSubscribers.mockReturnValue([vi.fn().mockResolvedValue(undefined)]);
    mocks.markDispatched.mockImplementation(async (source: string) => {
      await Promise.resolve();
      if (source === 'workflows') throw new Error('db unavailable');
    });

    const hasMore = await drainAndDispatch();

    expect(hasMore).toBe(true);
    expect(mocks.markDispatched).toHaveBeenCalledWith('workflows', ['success']);
    expect(mocks.markDispatched).toHaveBeenCalledWith('integrations', ['other']);
    expect(mocks.warnLog).toHaveBeenCalledWith(
      {err: expect.any(AggregateError)},
      'Outbox dispatch groups completed with errors',
    );
  });

  it('rejects a malformed schema-covered payload without capturing raw payload data', async () => {
    const event: DomainEvent = {
      id: crypto.randomUUID(),
      type: DEFINITION_RESOLVED,
      createdAt: new Date(),
      payload: {
        projectId: crypto.randomUUID(),
        workspaceId: crypto.randomUUID(),
        configPath: null,
        triggers: {},
        secret: 'raw-secret',
      },
    };
    mocks.drainAll.mockResolvedValueOnce(
      drain([{id: event.id, source: 'definitions', orderingKey: 'definitions', event}]),
    );
    mocks.getEventSchema.mockReturnValueOnce(definitionsEventSchemas[DEFINITION_RESOLVED]);

    await drainAndDispatch();

    expect(mocks.getSubscribers).not.toHaveBeenCalled();
    expect(mocks.markDispatched).not.toHaveBeenCalled();
    const failureContext = mocks.recordDispatchFailure.mock.calls[0]?.[2];
    expect(failureContext).toEqual({
      kind: 'validation',
      eventType: event.type,
      eventId: event.id,
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: ['definitionId'],
          code: expect.any(String),
          message: expect.any(String),
        }),
      ]),
    });
    expect(JSON.stringify(failureContext)).not.toContain('raw-secret');
    const captureOptions = mocks.captureException.mock.calls[0]?.[1];
    expect(captureOptions).toEqual({
      extra: expect.objectContaining({
        kind: 'validation',
        eventType: event.type,
        eventId: event.id,
      }),
    });
    expect(JSON.stringify(captureOptions)).not.toContain('raw-secret');
    expect(mocks.eventDispatchedAdd).toHaveBeenCalledWith(1, {
      module: 'definitions',
      outcome: 'failed',
    });
    expect(mocks.dispatchFailureAdd).toHaveBeenCalledWith(1, {
      module: 'definitions',
      reason: 'validation',
    });
  });

  it('passes the parsed payload to handlers when validation succeeds', async () => {
    const parsed = {jobId: 'job-1', runId: 'run-1', status: 'succeeded'};
    const handler = vi.fn().mockResolvedValue(undefined);
    const event: DomainEvent = {
      id: crypto.randomUUID(),
      type: 'workflows.job.terminated',
      createdAt: new Date(),
      payload: {...parsed, extra: 'raw'},
    };
    mocks.drainAll.mockResolvedValueOnce(
      drain([{id: event.id, source: 'workflows', orderingKey: 'run-1', event}]),
    );
    mocks.getEventSchema.mockReturnValueOnce({safeParse: () => ({success: true, data: parsed})});
    mocks.getSubscribers.mockReturnValueOnce([handler]);

    await drainAndDispatch();

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({type: event.type, payload: parsed}),
    );
    expect(mocks.markDispatched).toHaveBeenCalledWith('workflows', [event.id]);
    expect(mocks.eventDispatchedAdd).toHaveBeenCalledWith(1, {
      module: 'workflows',
      outcome: 'succeeded',
    });
    expect(mocks.recordDispatchFailure).not.toHaveBeenCalled();
  });

  it('validates and dispatches a valid event that has no subscribers', async () => {
    const parsed = {runId: 'run-1', projectId: 'proj-1', status: 'failed'};
    const event: DomainEvent = {
      id: crypto.randomUUID(),
      type: 'workflows.workflow_run.terminated',
      createdAt: new Date(),
      payload: parsed,
    };
    mocks.drainAll.mockResolvedValueOnce(
      drain([{id: event.id, source: 'workflows', orderingKey: 'run-1', event}]),
    );
    mocks.getEventSchema.mockReturnValueOnce({safeParse: () => ({success: true, data: parsed})});
    mocks.getSubscribers.mockReturnValueOnce([]);

    await drainAndDispatch();

    expect(mocks.markDispatched).toHaveBeenCalledWith('workflows', [event.id]);
    expect(mocks.eventDispatchedAdd).toHaveBeenCalledWith(1, {
      module: 'workflows',
      outcome: 'succeeded',
    });
    expect(mocks.recordDispatchFailure).not.toHaveBeenCalled();
  });

  it('isolates a poison row: dispatches valid siblings in the same drain and records the invalid one', async () => {
    const error = {issues: [{path: ['jobId'], code: 'invalid_type', message: 'expected string'}]};
    const validJob: DomainEvent = {
      id: crypto.randomUUID(),
      type: 'workflows.job.terminated',
      createdAt: new Date(),
      payload: {jobId: 'job-1', runId: 'run-1', status: 'succeeded'},
    };
    const poison: DomainEvent = {
      id: crypto.randomUUID(),
      type: 'workflows.job.terminated',
      createdAt: new Date(),
      payload: {jobId: 123},
    };
    const validPush: DomainEvent = {
      id: crypto.randomUUID(),
      type: 'integrations.source_control.commit_pushed',
      createdAt: new Date(),
      payload: {deliveryId: 'delivery-1'},
    };
    const handler = vi.fn().mockResolvedValue(undefined);
    mocks.drainAll.mockResolvedValueOnce(
      drain([
        {id: validJob.id, source: 'workflows', orderingKey: 'run-1', event: validJob},
        {id: poison.id, source: 'workflows', orderingKey: 'run-2', event: poison},
        {
          id: validPush.id,
          source: 'integrations',
          orderingKey: 'integrations',
          event: validPush,
        },
      ]),
    );
    mocks.getEventSchema
      .mockReturnValueOnce({safeParse: () => ({success: true, data: validJob.payload})})
      .mockReturnValueOnce({safeParse: () => ({success: false, error})})
      .mockReturnValueOnce({safeParse: () => ({success: true, data: validPush.payload})});
    mocks.getSubscribers.mockReturnValue([handler]);

    await drainAndDispatch();

    expect(mocks.markDispatched).toHaveBeenCalledWith('workflows', [validJob.id]);
    expect(mocks.markDispatched).toHaveBeenCalledWith('integrations', [validPush.id]);
    expect(mocks.markDispatched).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(mocks.recordDispatchFailure).toHaveBeenCalledWith('workflows', poison.id, {
      kind: 'validation',
      eventType: poison.type,
      eventId: poison.id,
      issues: error.issues,
    });
    expect(mocks.captureException).toHaveBeenCalledWith(error, {
      extra: {
        kind: 'validation',
        eventType: poison.type,
        eventId: poison.id,
        issues: error.issues,
      },
    });
    expect(mocks.drainBatchRecord).toHaveBeenCalledWith(3);
    expect(mocks.eventDispatchedAdd).toHaveBeenCalledWith(1, {
      module: 'workflows',
      outcome: 'failed',
    });
    expect(mocks.dispatchFailureAdd).toHaveBeenCalledWith(1, {
      module: 'workflows',
      reason: 'validation',
    });
    expect(mocks.eventDispatchedAdd).toHaveBeenCalledWith(1, {
      module: 'workflows',
      outcome: 'succeeded',
    });
    expect(mocks.eventDispatchedAdd).toHaveBeenCalledWith(1, {
      module: 'integrations',
      outcome: 'succeeded',
    });
    expect(mocks.eventDispatchedAdd).toHaveBeenCalledTimes(3);
  });

  it('records a row failure and skips dispatch when one of several handlers fails', async () => {
    const failure = new Error('second handler failed');
    const rowId = crypto.randomUUID();
    const parsed = {jobId: 'job-1', runId: 'run-1', status: 'succeeded'};
    const event: DomainEvent = {
      id: crypto.randomUUID(),
      type: 'workflows.job.terminated',
      createdAt: new Date(),
      payload: parsed,
    };
    const succeedingHandler = vi.fn().mockResolvedValue(undefined);
    const failingHandler = vi.fn().mockRejectedValueOnce(failure);
    mocks.drainAll.mockResolvedValueOnce(
      drain([{id: rowId, source: 'workflows', orderingKey: 'run-1', event}]),
    );
    mocks.getEventSchema.mockReturnValueOnce({safeParse: () => ({success: true, data: parsed})});
    mocks.getSubscribers.mockReturnValueOnce([succeedingHandler, failingHandler]);

    await drainAndDispatch();

    expect(succeedingHandler).toHaveBeenCalledTimes(1);
    expect(failingHandler).toHaveBeenCalledTimes(1);
    expect(mocks.recordDispatchFailure).toHaveBeenCalledTimes(1);
    expect(mocks.recordDispatchFailure).toHaveBeenCalledWith('workflows', rowId, {
      kind: 'handler',
      eventType: event.type,
      eventId: rowId,
      errorName: 'Error',
      errorMessage: 'second handler failed',
    });
    expect(mocks.eventDispatchedAdd).toHaveBeenCalledWith(1, {
      module: 'workflows',
      outcome: 'failed',
    });
    expect(mocks.dispatchFailureAdd).toHaveBeenCalledWith(1, {
      module: 'workflows',
      reason: 'handler',
    });
    expect(mocks.markDispatched).not.toHaveBeenCalled();
  });

  it('dispatches interleaved same-key events in created-at/id order while other keys run concurrently', async () => {
    const earlier = event('a', new Date('2026-01-01T00:00:00.000Z'));
    const later = event('b', new Date('2026-01-01T00:00:01.000Z'));
    const other = event('c', new Date('2026-01-01T00:00:00.500Z'));
    const calls: string[] = [];
    const handler = vi.fn(async (handled: DomainEvent) => {
      await Promise.resolve();
      calls.push((handled.payload as {jobId: string}).jobId);
    });
    mocks.drainAll.mockResolvedValueOnce(
      drain([
        {id: later.id, source: 'workflows', orderingKey: 'run-1', event: later},
        {id: other.id, source: 'workflows', orderingKey: 'run-2', event: other},
        {id: earlier.id, source: 'workflows', orderingKey: 'run-1', event: earlier},
      ]),
    );
    mocks.getSubscribers.mockReturnValue([handler]);

    await drainAndDispatch();

    expect(calls.indexOf('a')).toBeLessThan(calls.indexOf('b'));
    expect(mocks.markDispatched).toHaveBeenCalledWith('workflows', ['a', 'b']);
  });

  it('sorts each group by created-at then id even when drain order is scrambled', async () => {
    const first = event('a', new Date('2026-01-01T00:00:00.000Z'));
    const second = event('b', new Date('2026-01-01T00:00:00.000Z'));
    const third = event('c', new Date('2026-01-01T00:00:01.000Z'));
    const calls: string[] = [];
    const handler = vi.fn(async (handled: DomainEvent) => {
      await Promise.resolve();
      calls.push((handled.payload as {jobId: string}).jobId);
    });
    mocks.drainAll.mockResolvedValueOnce(
      drain([
        {id: third.id, source: 'workflows', orderingKey: 'run-1', event: third},
        {id: second.id, source: 'workflows', orderingKey: 'run-1', event: second},
        {id: first.id, source: 'workflows', orderingKey: 'run-1', event: first},
      ]),
    );
    mocks.getSubscribers.mockReturnValue([handler]);

    await drainAndDispatch();

    expect(calls).toEqual(['a', 'b', 'c']);
    expect(mocks.markDispatched).toHaveBeenCalledWith('workflows', ['a', 'b', 'c']);
  });

  it('halts a key group on the first failed row in the batch', async () => {
    const rows = [
      event('a', new Date('2026-01-01T00:00:00.000Z')),
      event('b', new Date('2026-01-01T00:00:01.000Z')),
      event('c', new Date('2026-01-01T00:00:02.000Z')),
    ];
    const handler = vi.fn(async (handled: DomainEvent) => {
      await Promise.resolve();
      if ((handled.payload as {jobId: string}).jobId === 'a') throw new Error('failed');
    });
    mocks.drainAll.mockResolvedValueOnce(
      drain(
        rows.map((row) => ({id: row.id, source: 'workflows', orderingKey: 'run-1', event: row})),
      ),
    );
    mocks.getSubscribers.mockReturnValue([handler]);

    await drainAndDispatch();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(mocks.recordDispatchFailure).toHaveBeenCalledWith('workflows', 'a', {
      kind: 'handler',
      eventType: rows[0]?.type,
      eventId: 'a',
      errorName: 'Error',
      errorMessage: 'failed',
    });
    expect(mocks.markDispatched).not.toHaveBeenCalled();
  });

  it('marks completed groups incrementally when a later group fails', async () => {
    const success = event('success', new Date('2026-01-01T00:00:00.000Z'));
    const failure = event('failure', new Date('2026-01-01T00:00:00.000Z'));
    const handler = vi.fn(async (handled: DomainEvent) => {
      await Promise.resolve();
      if ((handled.payload as {jobId: string}).jobId === 'failure') throw new Error('failed');
    });
    mocks.drainAll.mockResolvedValueOnce(
      drain([
        {id: success.id, source: 'workflows', orderingKey: 'run-1', event: success},
        {id: failure.id, source: 'workflows', orderingKey: 'run-2', event: failure},
      ]),
    );
    mocks.getSubscribers.mockReturnValue([handler]);

    await drainAndDispatch();

    expect(mocks.markDispatched).toHaveBeenCalledWith('workflows', ['success']);
    expect(mocks.recordDispatchFailure).toHaveBeenCalledWith(
      'workflows',
      'failure',
      expect.objectContaining({kind: 'handler', eventId: 'failure'}),
    );
  });

  it('runs cross-source groups in parallel while the source fallback key stays serial', async () => {
    let releaseWorkflow!: () => void;
    const workflowGate = new Promise<void>((resolve) => {
      releaseWorkflow = resolve;
    });
    const calls: string[] = [];
    const handler = vi.fn(async (handled: DomainEvent) => {
      const id = (handled.payload as {jobId: string}).jobId;
      calls.push(id);
      if (id === 'w1') await workflowGate;
    });
    const w1 = event('w1', new Date('2026-01-01T00:00:00.000Z'));
    const w2 = event('w2', new Date('2026-01-01T00:00:01.000Z'));
    const i1 = event('i1', new Date('2026-01-01T00:00:00.000Z'));
    mocks.drainAll.mockResolvedValueOnce(
      drain([
        {id: w1.id, source: 'workflows', orderingKey: 'workflows', event: w1},
        {id: w2.id, source: 'workflows', orderingKey: 'workflows', event: w2},
        {id: i1.id, source: 'integrations', orderingKey: 'integrations', event: i1},
      ]),
    );
    mocks.getSubscribers.mockReturnValue([handler]);

    const dispatch = drainAndDispatch();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toEqual(['w1', 'i1']);

    releaseWorkflow();
    await dispatch;

    expect(calls).toEqual(['w1', 'i1', 'w2']);
    expect(mocks.markDispatched).toHaveBeenCalledWith('workflows', ['w1', 'w2']);
    expect(mocks.markDispatched).toHaveBeenCalledWith('integrations', ['i1']);
  });
});
