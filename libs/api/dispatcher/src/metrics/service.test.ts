const mocks = vi.hoisted(() => {
  const gauge = {};
  return {
    addBatchObservableCallback: vi.fn(),
    countPendingOutboxRows: vi.fn(),
    createObservableGauge: vi.fn(() => gauge),
    gauge,
    getMeter: vi.fn(),
    getServiceMetricsProvider: vi.fn(),
  };
});

vi.mock('@shipfox/node-module', () => ({countPendingOutboxRows: mocks.countPendingOutboxRows}));
vi.mock('@shipfox/node-opentelemetry', () => ({
  getServiceMetricsProvider: mocks.getServiceMetricsProvider,
}));

import {registerDispatcherServiceMetrics} from './service.js';

describe('registerDispatcherServiceMetrics', () => {
  beforeEach(() => {
    mocks.addBatchObservableCallback.mockReset();
    mocks.countPendingOutboxRows.mockReset();
    mocks.createObservableGauge.mockClear();
    mocks.getMeter.mockReset();
    mocks.getServiceMetricsProvider.mockReset();
    mocks.getMeter.mockReturnValue({
      createObservableGauge: mocks.createObservableGauge,
      addBatchObservableCallback: mocks.addBatchObservableCallback,
    });
    mocks.getServiceMetricsProvider.mockReturnValue({getMeter: mocks.getMeter});
  });

  test('observes the pending rows across registered publishers', async () => {
    mocks.countPendingOutboxRows.mockResolvedValue(7);
    const outboxRegistry = {} as never;

    registerDispatcherServiceMetrics({outboxRegistry});
    const callback = mocks.addBatchObservableCallback.mock.calls[0]?.[0];
    const observer = {observe: vi.fn()};

    await callback?.(observer);

    expect(mocks.createObservableGauge).toHaveBeenCalledWith('dispatcher_pending_events', {
      description: 'Outbox events awaiting dispatch, including claimed and retry-delayed events',
    });
    expect(observer.observe).toHaveBeenCalledWith(mocks.gauge, 7);
    expect(mocks.countPendingOutboxRows).toHaveBeenCalledWith(outboxRegistry);
  });
});
