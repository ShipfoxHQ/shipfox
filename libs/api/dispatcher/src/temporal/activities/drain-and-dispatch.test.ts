import {DEFINITION_RESOLVED, definitionsEventSchemas} from '@shipfox/api-definitions-dto';
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
  eventDispatchedAdd: vi.fn(),
  dispatchFailureAdd: vi.fn(),
  drainBatchRecord: vi.fn(),
}));

vi.mock('@shipfox/node-error-monitoring', () => ({
  captureException: mocks.captureException,
}));

vi.mock('@shipfox/node-module', () => ({
  drainAll: mocks.drainAll,
  getEventSchema: mocks.getEventSchema,
  getSubscribers: mocks.getSubscribers,
  markDispatched: mocks.markDispatched,
  recordDispatchFailure: mocks.recordDispatchFailure,
}));

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
  }),
}));

describe('drainAndDispatch', () => {
  beforeEach(() => {
    mocks.captureException.mockReset();
    mocks.drainAll.mockReset();
    mocks.getEventSchema.mockReset();
    mocks.getSubscribers.mockReset();
    mocks.markDispatched.mockReset();
    mocks.recordDispatchFailure.mockReset();
    mocks.errorLog.mockReset();
    mocks.eventDispatchedAdd.mockReset();
    mocks.dispatchFailureAdd.mockReset();
    mocks.drainBatchRecord.mockReset();
  });

  it('records an empty drain batch tick', async () => {
    mocks.drainAll.mockResolvedValueOnce([]);

    await drainAndDispatch();

    expect(mocks.drainBatchRecord).toHaveBeenCalledWith(0);
    expect(mocks.eventDispatchedAdd).not.toHaveBeenCalled();
    expect(mocks.dispatchFailureAdd).not.toHaveBeenCalled();
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
    mocks.drainAll.mockResolvedValueOnce([{id: rowId, source: 'projects', event}]);
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
    mocks.drainAll.mockResolvedValueOnce([{id: event.id, source: 'definitions', event}]);
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
    mocks.drainAll.mockResolvedValueOnce([{id: event.id, source: 'workflows', event}]);
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
    mocks.drainAll.mockResolvedValueOnce([{id: event.id, source: 'workflows', event}]);
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
    mocks.drainAll.mockResolvedValueOnce([
      {id: validJob.id, source: 'workflows', event: validJob},
      {id: poison.id, source: 'workflows', event: poison},
      {id: validPush.id, source: 'integrations', event: validPush},
    ]);
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
    mocks.drainAll.mockResolvedValueOnce([{id: rowId, source: 'workflows', event}]);
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
});
