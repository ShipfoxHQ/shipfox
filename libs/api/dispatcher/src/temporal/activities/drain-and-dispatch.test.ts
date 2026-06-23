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
    expect(mocks.markDispatched).not.toHaveBeenCalled();
  });

  it('rejects a malformed payload at the drain: skips handlers and records a row failure', async () => {
    const error = {issues: [{path: ['jobId'], code: 'invalid_type', message: 'expected string'}]};
    const event: DomainEvent = {
      id: crypto.randomUUID(),
      type: 'workflows.job.terminated',
      createdAt: new Date(),
      payload: {jobId: 123},
    };
    mocks.drainAll.mockResolvedValueOnce([{id: event.id, source: 'workflows', event}]);
    mocks.getEventSchema.mockReturnValueOnce({safeParse: () => ({success: false, error})});

    await drainAndDispatch();

    expect(mocks.getSubscribers).not.toHaveBeenCalled();
    expect(mocks.markDispatched).not.toHaveBeenCalled();
    expect(mocks.recordDispatchFailure).toHaveBeenCalledWith('workflows', event.id, {
      kind: 'validation',
      eventType: event.type,
      eventId: event.id,
      issues: error.issues,
    });
    expect(mocks.captureException).toHaveBeenCalledWith(error, {
      extra: {
        kind: 'validation',
        eventType: event.type,
        eventId: event.id,
        issues: error.issues,
      },
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
  });
});
