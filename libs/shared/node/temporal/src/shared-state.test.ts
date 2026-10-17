const mocks = vi.hoisted(() => ({
  connectionClose: vi.fn(),
  connectionConnect: vi.fn(),
  runtimeInstall: vi.fn(),
}));

vi.mock('@temporalio/client', () => ({
  Client: class MockClient {},
  Connection: {connect: mocks.connectionConnect},
}));
vi.mock('@temporalio/worker', () => ({Runtime: {install: mocks.runtimeInstall}}));
vi.mock('@shipfox/node-opentelemetry', () => ({logger: () => ({info: vi.fn()})}));
vi.mock('./config.js', () => ({
  config: {
    OTEL_SDK_DISABLED: false,
    OTEL_TEMPORAL_METRICS_PORT: 9465,
    TEMPORAL_ADDRESS: 'temporal.example.test:7233',
    TEMPORAL_NAMESPACE: 'test-namespace',
  },
}));
vi.mock('./connection-options.js', () => ({
  getTemporalConnectionOptions: () => ({}),
  temporalConnectionError: (error: unknown) => error,
}));
vi.mock('./interceptors.js', () => ({getClientInterceptors: () => ({})}));

async function loadCopy() {
  vi.resetModules();
  return {
    client: await import('./client.js'),
    runtime: await import('./runtime.js'),
  };
}

function clearSharedState(): void {
  const store = globalThis as unknown as Record<symbol, unknown>;
  for (const key of [
    '@shipfox/node-process-state/registry/v1',
    '@shipfox/node-temporal/client/v1',
    '@shipfox/node-temporal/runtime/v1',
  ]) {
    delete store[Symbol.for(key)];
  }
}

describe('state shared between module instances', () => {
  beforeEach(() => {
    clearSharedState();
    mocks.connectionConnect.mockResolvedValue({close: mocks.connectionClose});
  });

  afterEach(() => {
    clearSharedState();
    vi.clearAllMocks();
  });

  it('exposes a client created through one instance to the other', async () => {
    const first = await loadCopy();
    const second = await loadCopy();

    const created = await first.client.createTemporalClient();

    expect(second.client.temporalClient()).toBe(created);
  });

  it('clears the client of both instances when either one closes it', async () => {
    const first = await loadCopy();
    const second = await loadCopy();
    await first.client.createTemporalClient();

    await second.client.closeTemporalClient();

    expect(() => first.client.temporalClient()).toThrow('Temporal client has not been created');
    expect(mocks.connectionClose).toHaveBeenCalledOnce();
  });

  it('reports the connection created by one instance as healthy through the other', async () => {
    mocks.connectionConnect.mockResolvedValue({healthService: {check: vi.fn()}});
    const first = await loadCopy();
    const second = await loadCopy();

    await first.client.createTemporalClient();

    await expect(second.client.isTemporalHealthy()).resolves.toBe(true);
  });

  it('installs the Temporal runtime once across instances', async () => {
    const first = await loadCopy();
    const second = await loadCopy();

    first.runtime.installTemporalRuntime();
    second.runtime.installTemporalRuntime();

    expect(mocks.runtimeInstall).toHaveBeenCalledOnce();
  });
});
