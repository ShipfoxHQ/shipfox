import {getTableConfig, pgTableCreator} from 'drizzle-orm/pg-core';
import {createOutboxTable, createPostgresOutboxTable} from './schema.js';
import {writeIdempotentOutboxEvent, writeOutboxEvent, writeOutboxEvents} from './write.js';

const outboxTable = createOutboxTable(pgTableCreator((name) => name));
const postgresOutboxTable = createPostgresOutboxTable(pgTableCreator((name) => name));

interface TestEventMap {
  'thing.created': {id: string};
  'thing.deleted': {id: string; reason: string};
}

describe('createOutboxTable', () => {
  it('exposes dispatch retry and dead-letter columns', () => {
    expect(outboxTable.orderingKey.name).toBe('ordering_key');
    expect(outboxTable.dispatchAttempts.name).toBe('dispatch_attempts');
    expect(outboxTable.nextDispatchAt.name).toBe('next_dispatch_at');
    expect(outboxTable.lastDispatchError.name).toBe('last_dispatch_error');
    expect(outboxTable.lastDispatchFailedAt.name).toBe('last_dispatch_failed_at');
    expect(outboxTable.deadLetteredAt.name).toBe('dead_lettered_at');
  });

  it('indexes dispatched rows for retention pruning', () => {
    const retentionIndex = getTableConfig(outboxTable).indexes.find(
      (index) => index.config.name === 'outbox_dispatched_retention_idx',
    );

    expect(retentionIndex).toBeDefined();
    expect(
      retentionIndex?.config.columns.map((column) => ('name' in column ? column.name : null)),
    ).toEqual(['dispatched_at', 'id']);
    expect(retentionIndex?.config.where).toBeDefined();
  });
});

describe('createPostgresOutboxTable', () => {
  it('adds idempotency and lease columns without changing the legacy table factory', () => {
    expect(postgresOutboxTable.idempotencyKey.name).toBe('idempotency_key');
    expect(postgresOutboxTable.leaseToken.name).toBe('lease_token');
    expect(postgresOutboxTable.leaseExpiresAt.name).toBe('lease_expires_at');
    expect('idempotencyKey' in outboxTable).toBe(false);
  });

  it('enforces unique idempotency keys and lease tokens', () => {
    const indexes = getTableConfig(postgresOutboxTable).indexes.map((index) => ({
      name: index.config.name,
      unique: index.config.unique,
    }));

    expect(indexes).toEqual(
      expect.arrayContaining([
        {name: 'outbox_idempotency_key_idx', unique: true},
        {name: 'outbox_lease_token_idx', unique: true},
      ]),
    );
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
      {eventType: 'thing.created', orderingKey: null, payload: {id: 'a'}},
      {eventType: 'thing.deleted', orderingKey: null, payload: {id: 'b', reason: 'gone'}},
    ]);
  });

  it('persists non-empty ordering keys and normalizes blank keys to null', async () => {
    const {tx, values} = fakeTx();

    await writeOutboxEvents<TestEventMap>(tx, outboxTable, [
      {type: 'thing.created', orderingKey: '  key-1  ', payload: {id: 'a'}},
      {type: 'thing.deleted', orderingKey: '   ', payload: {id: 'b', reason: 'gone'}},
    ]);

    expect(values).toHaveBeenCalledWith([
      {eventType: 'thing.created', orderingKey: 'key-1', payload: {id: 'a'}},
      {eventType: 'thing.deleted', orderingKey: null, payload: {id: 'b', reason: 'gone'}},
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
    expect(values).toHaveBeenCalledWith([
      {eventType: 'thing.created', orderingKey: null, payload: {id: 'a'}},
    ]);
  });
});

describe('writeIdempotentOutboxEvent', () => {
  function fakeIdempotentTx(inserted: Array<{id: string}>) {
    const returning = vi.fn().mockResolvedValue(inserted);
    const onConflictDoNothing = vi.fn(() => ({returning}));
    const values = vi.fn(() => ({onConflictDoNothing}));
    const insert = vi.fn(() => ({values}));
    return {tx: {insert}, values, onConflictDoNothing, returning};
  }

  it.each([
    ['created', [{id: '018f0000-0000-7000-8000-000000000000'}]],
    ['duplicate', []],
  ] as const)('returns %s from the conflict-safe insert', async (status, inserted) => {
    const {tx, onConflictDoNothing, returning} = fakeIdempotentTx([...inserted]);

    const result = await writeIdempotentOutboxEvent(tx, postgresOutboxTable, {
      idempotencyKey: ' event-1 ',
      type: ' thing.created ',
      orderingKey: ' aggregate-1 ',
      payload: {id: 'a'},
    });

    expect(result).toEqual({status});
    expect(onConflictDoNothing).toHaveBeenCalledWith({
      target: postgresOutboxTable.idempotencyKey,
    });
    expect(returning).toHaveBeenCalledWith({id: postgresOutboxTable.id});
  });

  it.each([
    ['idempotencyKey', {idempotencyKey: ' ', type: 'thing.created'}],
    ['type', {idempotencyKey: 'event-1', type: ' '}],
  ] as const)('rejects an empty %s before inserting', async (name, event) => {
    const {tx, values} = fakeIdempotentTx([]);

    const write = writeIdempotentOutboxEvent(tx, postgresOutboxTable, {
      ...event,
      payload: {id: 'a'},
    });

    await expect(write).rejects.toThrow(`${name} must not be empty`);
    expect(values).not.toHaveBeenCalled();
  });
});
