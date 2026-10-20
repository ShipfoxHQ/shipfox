const mocks = vi.hoisted(() => ({
  createLogger: vi.fn(() => ({child: vi.fn()})),
  resource: {attributes: {}},
  sdkShutdown: vi.fn(),
  sdkStart: vi.fn(),
  shouldStartTelemetry: vi.fn(() => false),
}));

vi.mock('@shipfox/node-log', () => ({createLogger: mocks.createLogger}));
vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: class MockNodeSDK {
    start = mocks.sdkStart;
    shutdown = mocks.sdkShutdown;
  },
}));
vi.mock('./common.js', () => ({
  getMetricsReader: () => undefined,
  getResource: () => mocks.resource,
  shouldExportTraces: () => false,
  shouldStartTelemetry: mocks.shouldStartTelemetry,
}));

const SHARED_KEYS = [
  '@shipfox/node-process-state/registry/v1',
  '@shipfox/node-opentelemetry/instance/v1',
  '@shipfox/node-opentelemetry/logger/v1',
  '@shipfox/node-opentelemetry/service-metrics/v1',
];

function clearSharedState(): void {
  const store = globalThis as unknown as Record<symbol, unknown>;
  for (const key of SHARED_KEYS) delete store[Symbol.for(key)];
}

async function loadCopy() {
  vi.resetModules();
  return {
    instance: await import('./instance.js'),
    logger: await import('./logger.js'),
    service: await import('./service.js'),
  };
}

describe('state shared between module instances', () => {
  beforeEach(clearSharedState);

  afterEach(() => {
    clearSharedState();
    vi.clearAllMocks();
    mocks.shouldStartTelemetry.mockReturnValue(false);
  });

  it('exposes instance instrumentation started through one instance to the other', async () => {
    const first = await loadCopy();
    const second = await loadCopy();
    mocks.shouldStartTelemetry.mockReturnValue(true);

    await first.instance.startInstanceInstrumentation({instrumentations: {fastify: true}});

    expect(second.instance.getInstanceResource()).toBe(mocks.resource);
    expect(second.instance.getFastifyInstrumentation()).toBe(
      first.instance.getFastifyInstrumentation(),
    );
    await expect(second.instance.startInstanceInstrumentation({})).rejects.toThrow(
      'Instrumentation already initialized',
    );
    await second.instance.shutdownInstanceInstrumentation();
    expect(mocks.sdkShutdown).toHaveBeenCalledOnce();
    expect(first.instance.getInstanceResource()).toBeUndefined();
  });

  it('shares the base logger between instances', async () => {
    const first = await loadCopy();
    const second = await loadCopy();

    expect(second.logger.logger()).toBe(first.logger.logger());
    expect(mocks.createLogger).toHaveBeenCalledOnce();
  });

  it('shares the service meter provider between instances', async () => {
    const first = await loadCopy();
    const second = await loadCopy();

    const provider = first.service.startServiceMetrics();

    expect(second.service.getServiceMetricsProvider()).toBe(provider);
  });
});
