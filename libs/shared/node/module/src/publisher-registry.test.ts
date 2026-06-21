import {createOutboxTable} from '@shipfox/node-outbox';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {pgTableCreator} from 'drizzle-orm/pg-core';
import {z} from 'zod';
import {getEventSchema, registerPublisher, resetPublishers} from './publisher-registry.js';

const table = createOutboxTable(pgTableCreator((name) => name));
const db = (() => undefined) as unknown as () => NodePgDatabase<Record<string, unknown>>;
const fooSchema = z.object({id: z.string()});

describe('getEventSchema', () => {
  beforeEach(() => {
    resetPublishers();
  });

  afterEach(() => {
    resetPublishers();
  });

  it('returns the schema a publisher registered for an event type', () => {
    registerPublisher({name: 'foo', table, db, eventSchemas: {'foo.created': fooSchema}});

    const schema = getEventSchema('foo.created');

    expect(schema).toBe(fooSchema);
  });

  it('returns undefined for an event type with no registered schema', () => {
    registerPublisher({name: 'foo', table, db, eventSchemas: {'foo.created': fooSchema}});

    const schema = getEventSchema('foo.unknown');

    expect(schema).toBeUndefined();
  });

  it('returns undefined for a publisher that registered no schemas', () => {
    registerPublisher({name: 'bar', table, db});

    const schema = getEventSchema('bar.created');

    expect(schema).toBeUndefined();
  });

  it('forgets registered schemas after resetPublishers', () => {
    registerPublisher({name: 'foo', table, db, eventSchemas: {'foo.created': fooSchema}});

    resetPublishers();

    expect(getEventSchema('foo.created')).toBeUndefined();
  });
});
