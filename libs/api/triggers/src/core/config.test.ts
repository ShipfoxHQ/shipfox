import {readConfigInputs, triggerFilterMatches} from './config.js';
import type {TriggerSubscription} from './entities/subscription.js';

function subscriptionWithConfig(config: Record<string, unknown>): TriggerSubscription {
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowDefinitionId: crypto.randomUUID(),
    name: 'test',
    source: 'github',
    event: 'push',
    config,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('readConfigInputs', () => {
  test('returns the with object when it is a plain object', () => {
    const inputs = readConfigInputs(subscriptionWithConfig({with: {env: 'staging'}}));

    expect(inputs).toEqual({env: 'staging'});
  });

  test('returns undefined when with is missing', () => {
    const inputs = readConfigInputs(subscriptionWithConfig({on: 'main'}));

    expect(inputs).toBeUndefined();
  });

  test('returns undefined when with is null', () => {
    const inputs = readConfigInputs(subscriptionWithConfig({with: null}));

    expect(inputs).toBeUndefined();
  });

  test('returns undefined when with is an array', () => {
    const inputs = readConfigInputs(subscriptionWithConfig({with: ['env']}));

    expect(inputs).toBeUndefined();
  });

  test('returns undefined when with is a primitive', () => {
    const inputs = readConfigInputs(subscriptionWithConfig({with: 'staging'}));

    expect(inputs).toBeUndefined();
  });
});

describe('triggerFilterMatches', () => {
  test('returns true when filter is missing', () => {
    const matches = triggerFilterMatches(subscriptionWithConfig({}), {ref: 'refs/heads/main'});

    expect(matches).toBe(true);
  });

  test('evaluates filter expressions against the event payload', () => {
    const subscription = subscriptionWithConfig({
      filter: 'event.ref == "refs/heads/main" && event.repository.full_name == "shipfox/platform"',
    });

    const matches = triggerFilterMatches(subscription, {
      ref: 'refs/heads/main',
      repository: {full_name: 'shipfox/platform'},
    });
    const misses = triggerFilterMatches(subscription, {
      ref: 'refs/heads/main',
      repository: {full_name: 'shipfox/docs'},
    });

    expect(matches).toBe(true);
    expect(misses).toBe(false);
  });

  test('throws when the stored filter cannot be parsed', () => {
    const subscription = subscriptionWithConfig({filter: 'event.ref =='});

    const act = () => triggerFilterMatches(subscription, {ref: 'refs/heads/main'});

    expect(act).toThrow();
  });
});
