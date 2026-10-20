const SHARED_KEYS = [
  '@shipfox/node-process-state/registry/v1',
  '@shipfox/node-drizzle/precise-timestamps/v1',
];

function clearSharedState(): void {
  const store = globalThis as unknown as Record<symbol, unknown>;
  for (const key of SHARED_KEYS) delete store[Symbol.for(key)];
}

async function loadCopy() {
  vi.resetModules();
  return await import('./cursor.js');
}

describe('state shared between module instances', () => {
  beforeEach(clearSharedState);
  afterEach(clearSharedState);

  it('keeps microsecond precision for a cursor created by the other instance', async () => {
    const first = await loadCopy();
    const second = await loadCopy();

    const cursor = first.createTimestampIdCursor({
      createdAt: '2026-10-20T12:00:00.123456Z',
      id: 'row-1',
    });

    expect(second.timestampIdCursorTimestamp(cursor)).toBe('2026-10-20T12:00:00.123456Z');
  });
});
