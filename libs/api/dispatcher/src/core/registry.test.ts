import {DEFINITION_RESOLVED} from '@shipfox/api-definitions-dto';
import {createOutboxRegistry, getSubscribers, subscribe} from '@shipfox/node-module';

describe('subscriber registry', () => {
  let registry = createOutboxRegistry();

  beforeEach(() => {
    registry = createOutboxRegistry();
  });

  test('returns empty array for unregistered event type', () => {
    const handlers = getSubscribers(registry, DEFINITION_RESOLVED);

    expect(handlers).toEqual([]);
  });

  test('returns registered handlers for an event type', () => {
    const handler = async () => Promise.resolve();
    subscribe(registry, DEFINITION_RESOLVED, handler);

    const handlers = getSubscribers(registry, DEFINITION_RESOLVED);

    expect(handlers).toHaveLength(1);
  });

  test('returns multiple handlers for the same event type', () => {
    const handler1 = async () => Promise.resolve();
    const handler2 = async () => Promise.resolve();
    subscribe(registry, DEFINITION_RESOLVED, handler1);
    subscribe(registry, DEFINITION_RESOLVED, handler2);

    const handlers = getSubscribers(registry, DEFINITION_RESOLVED);

    expect(handlers).toHaveLength(2);
  });

  test('registries do not share handlers', () => {
    subscribe(registry, DEFINITION_RESOLVED, async () => Promise.resolve());

    const handlers = getSubscribers(createOutboxRegistry(), DEFINITION_RESOLVED);

    expect(handlers).toEqual([]);
  });
});
