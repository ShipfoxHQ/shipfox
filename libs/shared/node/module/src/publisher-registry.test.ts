import {createOutboxTable} from '@shipfox/node-outbox';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {pgTableCreator} from 'drizzle-orm/pg-core';
import {z} from 'zod';
import {getEventSchema, registerPublisher, resetPublishers} from './publisher-registry.js';

const table = createOutboxTable(pgTableCreator((name) => name));
const db = (() => undefined) as unknown as () => NodePgDatabase<Record<string, unknown>>;
const fooSchema = z.object({id: z.string()});
const CONFLICTING_SCHEMA = /Conflicting outbox event schema/;

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

  it('throws when two publishers register a different schema for the same event type', () => {
    const otherSchema = z.object({id: z.string()});
    registerPublisher({name: 'foo', table, db, eventSchemas: {'foo.created': fooSchema}});

    const register = () =>
      registerPublisher({name: 'bar', table, db, eventSchemas: {'foo.created': otherSchema}});

    expect(register).toThrow(CONFLICTING_SCHEMA);
  });

  it('allows re-registering the identical schema for an event type', () => {
    registerPublisher({name: 'foo', table, db, eventSchemas: {'foo.created': fooSchema}});

    const register = () =>
      registerPublisher({name: 'foo', table, db, eventSchemas: {'foo.created': fooSchema}});

    expect(register).not.toThrow();
  });
});
