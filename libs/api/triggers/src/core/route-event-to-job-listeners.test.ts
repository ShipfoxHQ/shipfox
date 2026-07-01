import {jobListenerSubscriptionFactory} from '#test/index.js';

const deliverEventToListener = vi.fn();

vi.mock('@shipfox/api-workflows', () => ({
  deliverEventToListener: (...args: unknown[]) => deliverEventToListener(...args),
}));

const {routeEventToJobListeners} = await import('./route-event-to-job-listeners.js');

interface RouteOverrides {
  eventRef?: string;
  workspaceId?: string;
  source?: string;
  event?: string;
}

function route(overrides: RouteOverrides = {}) {
  return routeEventToJobListeners({
    eventRef: overrides.eventRef ?? crypto.randomUUID(),
    workspaceId: overrides.workspaceId ?? crypto.randomUUID(),
    provider: 'github',
    source: overrides.source ?? 'github',
    event: overrides.event ?? 'pull_request_review',
    deliveryId: crypto.randomUUID(),
    payload: {action: 'submitted'},
    receivedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
}

describe('routeEventToJobListeners', () => {
  beforeEach(() => {
    deliverEventToListener.mockReset();
    deliverEventToListener.mockResolvedValue({buffered: true, skipped: false});
  });

  it('computes resolve as the effective disposition when on and until match one job', async () => {
    const workspaceId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      jobId,
      kind: 'on',
      matcherOrdinal: 0,
      source: 'github',
      event: 'pull_request_review',
    });
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      jobId,
      kind: 'until',
      matcherOrdinal: 0,
      source: 'github',
      event: 'pull_request_review',
    });

    const result = await route({workspaceId});

    expect(deliverEventToListener).toHaveBeenCalledTimes(1);
    expect(deliverEventToListener).toHaveBeenCalledWith(
      expect.objectContaining({jobId, disposition: 'resolve'}),
    );
    expect(result).toMatchObject({
      matchedJobCount: 1,
      acceptedJobCount: 1,
      deliveredCount: 1,
      transientErrored: false,
    });
  });

  it('does not deliver when no listener subscription matches', async () => {
    const workspaceId = crypto.randomUUID();
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
    });

    const result = await route({workspaceId, event: 'pull_request'});

    expect(deliverEventToListener).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      matchedJobCount: 0,
      acceptedJobCount: 0,
      deliveredCount: 0,
      transientErrored: false,
    });
  });

  it('does not count skipped stale subscriptions as accepted deliveries', async () => {
    const workspaceId = crypto.randomUUID();
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'pull_request_review',
    });
    deliverEventToListener.mockResolvedValueOnce({buffered: false, skipped: true});

    const result = await route({workspaceId});

    expect(result).toMatchObject({
      matchedJobCount: 1,
      acceptedJobCount: 0,
      deliveredCount: 0,
      transientErrored: false,
    });
  });

  it('surfaces transient delivery errors after attempting every matched job', async () => {
    const workspaceId = crypto.randomUUID();
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      jobId: crypto.randomUUID(),
      source: 'github',
      event: 'pull_request_review',
    });
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      jobId: crypto.randomUUID(),
      source: 'github',
      event: 'pull_request_review',
    });
    const error = new Error('workflow db down');
    deliverEventToListener.mockRejectedValueOnce(error);

    const result = await route({workspaceId});

    expect(deliverEventToListener).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      matchedJobCount: 2,
      acceptedJobCount: 1,
      deliveredCount: 1,
      transientErrored: true,
      transientError: error,
    });
  });
});
