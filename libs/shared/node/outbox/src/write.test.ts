import {pgTableCreator} from 'drizzle-orm/pg-core';
import {createOutboxTable} from './schema.js';
import {writeOutboxEvent, writeOutboxEvents} from './write.js';

const outboxTable = createOutboxTable(pgTableCreator((name) => name));

interface TestEventMap {
  'thing.created': {id: string};
  'thing.deleted': {id: string; reason: string};
}

describe('createOutboxTable', () => {
  it('exposes dispatch retry and dead-letter columns', () => {
    expect(outboxTable.dispatchAttempts.name).toBe('dispatch_attempts');
    expect(outboxTable.nextDispatchAt.name).toBe('next_dispatch_at');
    expect(outboxTable.lastDispatchError.name).toBe('last_dispatch_error');
    expect(outboxTable.lastDispatchFailedAt.name).toBe('last_dispatch_failed_at');
    expect(outboxTable.deadLetteredAt.name).toBe('dead_lettered_at');
  });
});

function fakeTx() {
  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn(() => ({values}));
  return {tx: {insert}, insert, values};
}

describe('writeOutboxEvents', () => {
  it('is a no-op for an empty batch (Drizzle rejects values([]))', async () => {
    const {tx, insert, values} = fakeTx();

    await writeOutboxEvents<TestEventMap>(tx, outboxTable, []);

    expect(insert).not.toHaveBeenCalled();
    expect(values).not.toHaveBeenCalled();
  });

  it('maps every event to one multi-row insert', async () => {
    const {tx, insert, values} = fakeTx();

    await writeOutboxEvents<TestEventMap>(tx, outboxTable, [
      {type: 'thing.created', payload: {id: 'a'}},
      {type: 'thing.deleted', payload: {id: 'b', reason: 'gone'}},
    ]);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(outboxTable);
    expect(values).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith([
      {eventType: 'thing.created', payload: {id: 'a'}},
      {eventType: 'thing.deleted', payload: {id: 'b', reason: 'gone'}},
    ]);
  });
});

describe('writeOutboxEvent', () => {
  it('delegates to writeOutboxEvents with a single-element batch', async () => {
    const {tx, values} = fakeTx();

    await writeOutboxEvent<TestEventMap>(tx, outboxTable, {
      type: 'thing.created',
      payload: {id: 'a'},
    });

    expect(values).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith([{eventType: 'thing.created', payload: {id: 'a'}}]);
  });
});
