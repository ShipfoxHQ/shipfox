const SHARED_KEYS = ['@shipfox/node-process-state/registry/v1', '@shipfox/node-log/logger/v1'];

function clearSharedState(): void {
  const store = globalThis as unknown as Record<symbol, unknown>;
  for (const key of SHARED_KEYS) delete store[Symbol.for(key)];
}

function sharedLogger(): {info: (...args: unknown[]) => void} | undefined {
  const store = globalThis as unknown as Record<symbol, {logger?: {info: () => void}}>;
  return store[Symbol.for('@shipfox/node-log/logger/v1')]?.logger;
}

async function loadCopy() {
  vi.resetModules();
  return await import('./log.js');
}

describe('state shared between module instances', () => {
  beforeEach(() => {
    clearSharedState();
    vi.stubEnv('LOG_STDOUT', 'false');
  });

  afterEach(() => {
    clearSharedState();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('logs through the default logger created by the other instance', async () => {
    const first = await loadCopy();
    const second = await loadCopy();
    first.log.info('first');
    const logger = sharedLogger();
    if (!logger) throw new Error('Expected the first instance to create the default logger');
    const info = vi.spyOn(logger, 'info');

    second.log.info('second');

    expect(info).toHaveBeenCalledWith('second');
  });
});
