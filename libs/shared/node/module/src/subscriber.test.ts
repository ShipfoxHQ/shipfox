import type {DomainEvent} from '@shipfox/node-outbox';
import {type ModuleSubscriber, subscriberFactory} from './subscriber.js';

interface TestEventMap {
  'thing.created': {id: string};
  'thing.deleted': {id: string; reason: string};
}

const subscriber = subscriberFactory<TestEventMap>();

function domainEvent<T>(type: string, payload: T): DomainEvent<T> {
  return {id: 'evt-1', type, payload, createdAt: new Date('2026-01-01T00:00:00Z')};
}

describe('subscriberFactory', () => {
  it('forwards the event payload as the first handler argument', async () => {
    const seen: Array<{id: string}> = [];
    const sub = subscriber('thing.created', (payload) => {
      seen.push(payload);
      return Promise.resolve();
    });

    await sub.handler(domainEvent('thing.created', {id: 'a'}));

    expect(seen).toEqual([{id: 'a'}]);
  });

  it('forwards the whole domain event as the second handler argument', async () => {
    const event = domainEvent('thing.deleted', {id: 'b', reason: 'gone'});
    let received: DomainEvent<{id: string; reason: string}> | undefined;
    const sub = subscriber('thing.deleted', (_payload, e) => {
      received = e;
      return Promise.resolve();
    });

    await sub.handler(event);

    expect(received).toBe(event);
  });

  it('registers the subscriber under the given event name', () => {
    const sub = subscriber('thing.created', () => Promise.resolve());

    expect(sub.event).toBe('thing.created');
  });

  it('accepts a payload-only handler', async () => {
    let seenId: string | undefined;
    const sub = subscriber('thing.created', ({id}) => {
      seenId = id;
      return Promise.resolve();
    });

    await sub.handler(domainEvent('thing.created', {id: 'c'}));

    expect(seenId).toBe('c');
  });
});

// These never run; the @ts-expect-error directives fail the build if the type
// constraints ever stop holding, which is the real protection this file adds.
describe('subscriberFactory type safety', () => {
  it('rejects unknown events, mismatched payloads, and forged subscribers', () => {
    // @ts-expect-error 'thing.unknown' is not a key of TestEventMap
    subscriber('thing.unknown', () => Promise.resolve());

    subscriber('thing.created', (payload) => {
      // @ts-expect-error 'reason' exists only on 'thing.deleted', not 'thing.created'
      void payload.reason;
      return Promise.resolve();
    });

    // @ts-expect-error a raw literal cannot mint the private brand
    const forged: ModuleSubscriber = {event: 'x', handler: () => Promise.resolve()};
    void forged;

    expect(true).toBe(true);
  });
});
