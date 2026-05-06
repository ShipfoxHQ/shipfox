import type {DomainEvent} from '@shipfox/node-outbox';
import {drainAndDispatch} from './drain-and-dispatch.js';

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  drainAll: vi.fn(),
  getSubscribers: vi.fn(),
  markDispatched: vi.fn(),
  errorLog: vi.fn(),
}));

vi.mock('@shipfox/node-error-monitoring', () => ({
  captureException: mocks.captureException,
}));

vi.mock('@shipfox/node-module', () => ({
  drainAll: mocks.drainAll,
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
});
