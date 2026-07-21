const mocks = vi.hoisted(() => {
  const gauge = {};
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

import type {Ec2Engine} from '#ec2-engine.js';
import {registerEc2ServiceMetrics} from './service.js';

describe('registerEc2ServiceMetrics', () => {
  beforeEach(() => {
    mocks.addBatchObservableCallback.mockReset();
    mocks.createObservableGauge.mockClear();
    mocks.getMeter.mockReset();
    mocks.getServiceMetricsProvider.mockReset();
    mocks.getMeter.mockReturnValue({
      createObservableGauge: mocks.createObservableGauge,
      addBatchObservableCallback: mocks.addBatchObservableCallback,
    });
    mocks.getServiceMetricsProvider.mockReturnValue({getMeter: mocks.getMeter});
  });

  it('observes managed instances by bounded EC2 state', async () => {
    const listManaged = vi
      .fn()
      .mockResolvedValue([{state: 'pending'}, {state: 'running'}, {state: 'running'}]);
    const engine = {listManaged} as unknown as Ec2Engine;

    registerEc2ServiceMetrics({engine, provisionerId: 'provisioner-1'});
    const callback = mocks.addBatchObservableCallback.mock.calls[0]?.[0];
    const observer = {observe: vi.fn()};

    await callback?.(observer);

    expect(mocks.createObservableGauge).toHaveBeenCalledWith('ec2_provisioner_managed_instances', {
      description: 'EC2 runner instances currently managed by the provisioner, by EC2 state',
    });
    expect(listManaged).toHaveBeenCalledWith('provisioner-1');
    expect(observer.observe).toHaveBeenCalledWith(mocks.gauge, 1, {state: 'pending'});
    expect(observer.observe).toHaveBeenCalledWith(mocks.gauge, 2, {state: 'running'});
  });
});
