const SHARED_KEYS = ['@shipfox/node-process-state/registry/v1', '@shipfox/node-postgres/pool/v1'];

function clearSharedState(): void {
  const store = globalThis as unknown as Record<symbol, unknown>;
  for (const key of SHARED_KEYS) delete store[Symbol.for(key)];
}

async function loadCopy() {
  vi.resetModules();
  return await import('./index.js');
}

describe('state shared between module instances', () => {
  beforeEach(clearSharedState);
  afterEach(clearSharedState);

  it('exposes a pool created through one instance to the other', async () => {
    const first = await loadCopy();
    const second = await loadCopy();

    const pool = first.createPostgresClient();

    expect(second.pgClient()).toBe(pool);
    expect(() => second.createPostgresClient()).toThrow('Postgres client has already been created');
    await second.closePostgresClient();
    expect(() => first.pgClient()).toThrow('Postgres client has not been created');
  });
});
