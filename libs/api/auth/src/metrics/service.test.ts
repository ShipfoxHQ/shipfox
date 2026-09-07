const mocks = vi.hoisted(() => {
  const gauge = {name: 'open-windows'};
  return {
    addBatchObservableCallback: vi.fn(),
    createObservableGauge: vi.fn(() => gauge),
    gauge,
    getMeter: vi.fn(),
    getServiceMetricsProvider: vi.fn(),
  };
});

vi.mock('@shipfox/node-opentelemetry', () => ({
  getServiceMetricsProvider: mocks.getServiceMetricsProvider,
}));

const {registerAuthServiceMetrics} = await import('./service.js');

describe('registerAuthServiceMetrics', () => {
  beforeEach(() => {
    mocks.addBatchObservableCallback.mockReset();
    mocks.createObservableGauge.mockClear();
    mocks.getMeter.mockReset();
    mocks.getServiceMetricsProvider.mockReset();
    mocks.getMeter.mockReturnValue({
      addBatchObservableCallback: mocks.addBatchObservableCallback,
      createObservableGauge: mocks.createObservableGauge,
    });
    mocks.getServiceMetricsProvider.mockReturnValue({getMeter: mocks.getMeter});
  });

  it('defines an unlabeled open-window service gauge', async () => {
    const reader = {countOpenImpersonationWindows: vi.fn().mockResolvedValue(3)};
    registerAuthServiceMetrics(reader);

    expect(mocks.createObservableGauge).toHaveBeenCalledWith('auth_impersonation_windows_open', {
      description: 'Impersonation windows currently open across all actors',
    });
    const callback = mocks.addBatchObservableCallback.mock.calls[0]?.[0];
    if (typeof callback !== 'function') throw new Error('Expected metrics callback');
    const observer = {observe: vi.fn()};

    await callback(observer);

    expect(reader.countOpenImpersonationWindows).toHaveBeenCalledOnce();
    expect(observer.observe).toHaveBeenCalledWith(mocks.gauge, 3);
  });
});
