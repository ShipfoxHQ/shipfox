const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  connectionConnect: vi.fn(),
  getClientInterceptors: vi.fn(),
  getTemporalConnectionOptions: vi.fn(),
  installTemporalRuntime: vi.fn(),
  logger: {info: vi.fn()},
}));

vi.mock('@temporalio/client', () => ({
  Client: mocks.client,
  Connection: {connect: mocks.connectionConnect},
}));

vi.mock('@shipfox/node-opentelemetry', () => ({logger: () => mocks.logger}));
vi.mock('./config.js', () => ({
  config: {
    TEMPORAL_ADDRESS: 'temporal.example.test:7233',
    TEMPORAL_NAMESPACE: 'test-namespace',
  },
}));
vi.mock('./connection-options.js', () => ({
  getTemporalConnectionOptions: mocks.getTemporalConnectionOptions,
  temporalConnectionError: (error: unknown) => error,
}));
vi.mock('./interceptors.js', () => ({getClientInterceptors: mocks.getClientInterceptors}));
vi.mock('./runtime.js', () => ({installTemporalRuntime: mocks.installTemporalRuntime}));

import {createTemporalClient} from './client.js';

describe('createTemporalClient', () => {
  it('installs runtime telemetry before opening the connection', async () => {
    const connection = {};
    const client = {};
    mocks.connectionConnect.mockResolvedValue(connection);
    mocks.client.mockImplementation(function MockClient() {
      return client;
    });
    mocks.getTemporalConnectionOptions.mockReturnValue({address: 'temporal.example.test:7233'});
    mocks.getClientInterceptors.mockReturnValue({workflow: []});

    const result = await createTemporalClient();

    expect(result).toBe(client);
    expect(mocks.installTemporalRuntime).toHaveBeenCalledOnce();
    expect(mocks.installTemporalRuntime.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.connectionConnect.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });
});
