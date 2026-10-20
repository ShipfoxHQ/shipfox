const SHARED_KEYS = [
  '@shipfox/node-process-state/registry/v1',
  '@shipfox/node-error-monitoring/reported-errors/v1',
];

function clearSharedState(): void {
  const store = globalThis as unknown as Record<symbol, unknown>;
  for (const key of SHARED_KEYS) delete store[Symbol.for(key)];
}

async function loadCopy() {
  vi.resetModules();
  return await import('./report-error.js');
}

describe('state shared between module instances', () => {
  beforeEach(clearSharedState);
  afterEach(clearSharedState);

  test('sees a frozen error marked as reported by the other instance', async () => {
    const first = await loadCopy();
    const second = await loadCopy();
    const error = Object.freeze(new Error('already reported'));

    first.markErrorReported(error);

    expect(second.isErrorReported(error)).toBe(true);
  });
});
