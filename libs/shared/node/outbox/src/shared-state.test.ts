import {pgTableCreator} from 'drizzle-orm/pg-core';
import {createOutboxTable} from './schema.js';

const SHARED_KEYS = [
  '@shipfox/node-process-state/registry/v1',
  '@shipfox/node-outbox/write-listeners/v1',
];

const outboxTable = createOutboxTable(pgTableCreator((name) => name));

function clearSharedState(): void {
  const store = globalThis as unknown as Record<symbol, unknown>;
  for (const key of SHARED_KEYS) delete store[Symbol.for(key)];
}

async function loadCopy() {
  vi.resetModules();
  return await import('./write.js');
}

describe('state shared between module instances', () => {
  beforeEach(clearSharedState);
  afterEach(clearSharedState);

  it('notifies a listener registered through one instance of writes through the other', async () => {
    const first = await loadCopy();
    const second = await loadCopy();
    const listener = vi.fn();
    const tx = {insert: () => ({values: () => Promise.resolve()})};
    first.onOutboxWrite(listener);

    await second.writeOutboxEvent(tx, outboxTable, {type: 'thing.created', payload: {id: '1'}});

    expect(listener).toHaveBeenCalledOnce();
  });
});
