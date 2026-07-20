import {createOutboxTable} from '@shipfox/node-outbox';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {pgTableCreator} from 'drizzle-orm/pg-core';
import {z} from 'zod';

const mocks = vi.hoisted(() => ({warn: vi.fn()}));

vi.mock('@shipfox/node-opentelemetry', () => ({logger: () => ({warn: mocks.warn})}));

import {
  countPendingOutboxRows,
  createOutboxRegistry,
  getEventSchema,
  getRegisteredPublisherNames,
  pruneDispatchedOutboxRows,
  registerPublisher,
} from './publisher-registry.js';

const table = createOutboxTable(pgTableCreator((name) => name));
const db = (() => undefined) as unknown as () => NodePgDatabase<Record<string, unknown>>;
const fooSchema = z.object({id: z.string()});
const CONFLICTING_SCHEMA = /Conflicting outbox event schema/;
let registry = createOutboxRegistry();

describe('getEventSchema', () => {
  beforeEach(() => {
    registry = createOutboxRegistry();
  });

  it('returns the schema a publisher registered for an event type', () => {
    registerPublisher(registry, {name: 'foo', table, db, eventSchemas: {'foo.created': fooSchema}});

    const schema = getEventSchema(registry, 'foo.created');

    expect(schema).toBe(fooSchema);
  });

  it('returns undefined for an event type with no registered schema', () => {
    registerPublisher(registry, {name: 'foo', table, db, eventSchemas: {'foo.created': fooSchema}});

    const schema = getEventSchema(registry, 'foo.unknown');

    expect(schema).toBeUndefined();
  });

  it('returns undefined for a publisher that registered no schemas', () => {
    registerPublisher(registry, {name: 'bar', table, db});

    const schema = getEventSchema(registry, 'bar.created');

    expect(schema).toBeUndefined();
  });

  it('keeps schemas isolated to their registry', () => {
    registerPublisher(registry, {name: 'foo', table, db, eventSchemas: {'foo.created': fooSchema}});

    registry = createOutboxRegistry();

    expect(getEventSchema(registry, 'foo.created')).toBeUndefined();
  });

  it('throws when two publishers register a different schema for the same event type', () => {
    const otherSchema = z.object({id: z.string()});
    registerPublisher(registry, {name: 'foo', table, db, eventSchemas: {'foo.created': fooSchema}});

    const register = () =>
      registerPublisher(registry, {
        name: 'bar',
        table,
        db,
        eventSchemas: {'foo.created': otherSchema},
      });

    expect(register).toThrow(CONFLICTING_SCHEMA);
  });

  it('allows re-registering the identical schema for an event type', () => {
    registerPublisher(registry, {name: 'foo', table, db, eventSchemas: {'foo.created': fooSchema}});

    const register = () =>
      registerPublisher(registry, {
        name: 'foo',
        table,
        db,
        eventSchemas: {'foo.created': fooSchema},
      });

    expect(register).not.toThrow();
  });
});

describe('getRegisteredPublisherNames', () => {
  beforeEach(() => {
    registry = createOutboxRegistry();
  });

  it('returns an empty array when no publishers are registered', () => {
    expect(getRegisteredPublisherNames(registry)).toEqual([]);
  });

  it('returns registered publisher names in registration order', () => {
    registerPublisher(registry, {name: 'foo', table, db});
    registerPublisher(registry, {name: 'bar', table, db});

    expect(getRegisteredPublisherNames(registry)).toEqual(['foo', 'bar']);
  });

  it('keeps publisher names isolated to their registry', () => {
    registerPublisher(registry, {name: 'foo', table, db});

    registry = createOutboxRegistry();

    expect(getRegisteredPublisherNames(registry)).toEqual([]);
  });
});

describe('pruneDispatchedOutboxRows', () => {
  beforeEach(() => {
    registry = createOutboxRegistry();
  });

  it.each([
    ['retentionDays', {retentionDays: 0, batchSize: 5_000, maxBatchesPerSource: 200}],
    ['batchSize', {retentionDays: 7, batchSize: 0, maxBatchesPerSource: 200}],
    ['maxBatchesPerSource', {retentionDays: 7, batchSize: 5_000, maxBatchesPerSource: 0}],
    ['retentionDays', {retentionDays: 7.5, batchSize: 5_000, maxBatchesPerSource: 200}],
  ])('rejects a non-positive-integer %s before touching the database', async (name, options) => {
    const prune = pruneDispatchedOutboxRows(registry, options);

    await expect(prune).rejects.toThrow(`${name} must be a positive integer`);
  });

  it('returns no results when no publishers are registered', async () => {
    const results = await pruneDispatchedOutboxRows(registry, {
      retentionDays: 7,
      batchSize: 5_000,
      maxBatchesPerSource: 200,
    });

    expect(results).toEqual([]);
  });
});

describe('countPendingOutboxRows', () => {
  beforeEach(() => {
    mocks.warn.mockClear();
    registry = createOutboxRegistry();
  });

  it('returns zero when no publishers are registered', async () => {
    const pendingRows = await countPendingOutboxRows(registry);

    expect(pendingRows).toBe(0);
  });

  it('logs failed sources and returns the counts from successful sources', async () => {
    const failure = new Error('database unavailable');
    const successfulDb = (() => ({
      select: () => ({from: () => ({where: () => Promise.resolve([{count: 3}])})}),
    })) as unknown as () => NodePgDatabase<Record<string, unknown>>;
    const failedDb = (() => ({
      select: () => ({from: () => ({where: () => Promise.reject(failure)})}),
    })) as unknown as () => NodePgDatabase<Record<string, unknown>>;
    registerPublisher(registry, {name: 'successful', table, db: successfulDb});
    registerPublisher(registry, {name: 'failed', table, db: failedDb});

    const pendingRows = await countPendingOutboxRows(registry);

    expect(pendingRows).toBe(3);
    expect(mocks.warn).toHaveBeenCalledWith(
      {err: failure, source: 'failed'},
      'Failed to count pending outbox rows',
    );
  });
});
