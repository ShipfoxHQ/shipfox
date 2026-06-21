import type {DomainEvent} from '@shipfox/node-outbox';
import {drainAndDispatch} from './drain-and-dispatch.js';

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  drainAll: vi.fn(),
  getEventSchema: vi.fn(),
  getSubscribers: vi.fn(),
  markDispatched: vi.fn(),
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
    mocks.errorLog.mockReset();
  });

  it('logs payload context and captures failed subscriber exceptions', async () => {
    const failure = new Error('subscriber failed');
    const event: DomainEvent = {
      id: crypto.randomUUID(),
      type: 'projects.project.source_bound',
      createdAt: new Date(),
      payload: {
        projectId: crypto.randomUUID(),
        workspaceId: crypto.randomUUID(),
      },
    };
    mocks.drainAll.mockResolvedValueOnce([{id: crypto.randomUUID(), source: 'projects', event}]);
    mocks.getSubscribers.mockReturnValueOnce([vi.fn().mockRejectedValueOnce(failure)]);

    await drainAndDispatch();

    expect(mocks.errorLog).toHaveBeenCalledWith(
      {
        err: failure,
        eventType: event.type,
        eventId: expect.any(String),
        eventPayload: event.payload,
      },
      'Handler failed for outbox event',
    );
    expect(mocks.captureException).toHaveBeenCalledWith(failure, {
      extra: {
        eventType: event.type,
        eventId: expect.any(String),
        eventPayload: event.payload,
      },
    });
    expect(mocks.markDispatched).not.toHaveBeenCalled();
  });

  it('rejects a malformed payload at the drain: skips handlers and leaves the row undispatched', async () => {
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
    expect(mocks.captureException).toHaveBeenCalledWith(error, {
      extra: {eventType: event.type, eventId: event.id, issues: error.issues},
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
  });
});
