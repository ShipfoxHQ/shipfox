import {temporalRuntimeOptions} from './runtime.js';

describe('temporalRuntimeOptions', () => {
  it('exposes native Temporal metrics through a dedicated Prometheus endpoint', () => {
    const result = temporalRuntimeOptions(19465);

    expect(result).toEqual({
      telemetryOptions: {
        metrics: {
          prometheus: {
            bindAddress: '0.0.0.0:19465',
            countersTotalSuffix: true,
            unitSuffix: true,
          },
          attachServiceName: false,
        },
      },
    });
  });
});
