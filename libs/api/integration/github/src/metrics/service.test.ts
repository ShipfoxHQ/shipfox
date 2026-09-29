const mocks = vi.hoisted(() => ({
  addBatchObservableCallback: vi.fn(),
  countStaleGithubUnlinkedInstallations: vi.fn(),
  createObservableGauge: vi.fn(),
  getMeter: vi.fn(),
  getServiceMetricsProvider: vi.fn(),
  gauge: {},
}));

vi.mock('@shipfox/node-opentelemetry', () => ({
  getServiceMetricsProvider: mocks.getServiceMetricsProvider,
}));
vi.mock('#db/unlinked-installations.js', () => ({
  countStaleGithubUnlinkedInstallations: mocks.countStaleGithubUnlinkedInstallations,
}));

import {registerGithubServiceMetrics} from './service.js';

describe('registerGithubServiceMetrics', () => {
  beforeEach(() => {
    mocks.addBatchObservableCallback.mockReset();
    mocks.countStaleGithubUnlinkedInstallations.mockReset();
    mocks.createObservableGauge.mockReset();
    mocks.getMeter.mockReset();
    mocks.getServiceMetricsProvider.mockReset();
    mocks.createObservableGauge.mockReturnValue(mocks.gauge);
    mocks.getMeter.mockReturnValue({
      addBatchObservableCallback: mocks.addBatchObservableCallback,
      createObservableGauge: mocks.createObservableGauge,
    });
    mocks.getServiceMetricsProvider.mockReturnValue({getMeter: mocks.getMeter});
  });

  it('observes stale unlinked installations as a service gauge', async () => {
    mocks.countStaleGithubUnlinkedInstallations.mockResolvedValue(3);

    registerGithubServiceMetrics();
    const callback = mocks.addBatchObservableCallback.mock.calls[0]?.[0];
    if (typeof callback !== 'function') throw new Error('Expected metrics callback');
    const observer = {observe: vi.fn()};

    await callback(observer);

    expect(mocks.getMeter).toHaveBeenCalledWith('github');
    expect(mocks.createObservableGauge).toHaveBeenCalledWith(
      'integrations_github_unlinked_installations',
      {
        description:
          'GitHub installations seen through webhooks for more than one hour without a linked installation',
      },
    );
    expect(observer.observe).toHaveBeenCalledWith(mocks.gauge, 3);
  });
});
