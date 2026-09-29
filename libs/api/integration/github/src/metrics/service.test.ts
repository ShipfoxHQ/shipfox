import {sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {githubInstallations} from '#db/schema/installations.js';
import {githubUnlinkedInstallations} from '#db/schema/unlinked-installations.js';

const mocks = vi.hoisted(() => {
  const gauge = {};
  const addBatchObservableCallback = vi.fn();
  const createObservableGauge = vi.fn(() => gauge);
  return {
    gauge,
    addBatchObservableCallback,
    createObservableGauge,
    getServiceMetricsProvider: vi.fn(() => ({
      getMeter: () => ({createObservableGauge, addBatchObservableCallback}),
    })),
  };
});

vi.mock('@shipfox/node-opentelemetry', () => ({
  getServiceMetricsProvider: mocks.getServiceMetricsProvider,
}));

const {registerGithubServiceMetrics} = await import('./service.js');

describe('GitHub service metrics', () => {
  beforeEach(async () => {
    await db().delete(githubInstallations);
    await db().delete(githubUnlinkedInstallations);
    mocks.addBatchObservableCallback.mockReset();
    mocks.createObservableGauge.mockClear();
  });

  it('reports only stale unlinked installations', async () => {
    await db().insert(githubUnlinkedInstallations).values({
      installationId: 'unlinked-stale',
      accountLogin: 'opsmill',
      accountType: 'Organization',
      repositorySelection: 'all',
      senderLogin: null,
      requesterLogin: null,
      lastAction: 'created',
      firstSeenAt: sql`now() - interval '2 hours'`,
      lastSeenAt: sql`now() - interval '2 hours'`,
    });
    await db().insert(githubInstallations).values({
      connectionId: crypto.randomUUID(),
      installationId: 'linked-stale',
      accountLogin: 'shipfox',
      accountType: 'Organization',
      repositorySelection: 'all',
      latestEvent: {},
    });
    await db().insert(githubUnlinkedInstallations).values({
      installationId: 'linked-stale',
      accountLogin: 'shipfox',
      accountType: 'Organization',
      repositorySelection: 'all',
      senderLogin: null,
      requesterLogin: null,
      lastAction: 'created',
      firstSeenAt: sql`now() - interval '2 hours'`,
      lastSeenAt: sql`now() - interval '2 hours'`,
    });

    registerGithubServiceMetrics();
    const callback = mocks.addBatchObservableCallback.mock.calls[0]?.[0];
    if (!callback) throw new Error('Expected a metrics callback');
    const observer = {observe: vi.fn()};

    await callback(observer);

    expect(observer.observe).toHaveBeenCalledWith(mocks.gauge, 1);
  });
});
