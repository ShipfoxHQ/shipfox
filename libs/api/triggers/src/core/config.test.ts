import {evaluateTriggerFilter, readConfigInputs} from './config.js';
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

describe('evaluateTriggerFilter', () => {
  test('returns matched when filter is missing', () => {
    const result = evaluateTriggerFilter({
      subscription: subscriptionWithConfig({}),
      source: 'github',
      event: 'push',
      payload: {ref: 'refs/heads/main'},
    });

    expect(result).toEqual({kind: 'matched'});
  });

  test('evaluates filter expressions against the event payload and trigger identity', () => {
    const subscription = subscriptionWithConfig({
      filter:
        'event.ref == "refs/heads/main" && event.repository.full_name == "shipfox/platform" && trigger.source == "github" && trigger.event == "push"',
    });

    const matches = evaluateTriggerFilter({
      subscription,
      source: 'github',
      event: 'push',
      payload: {
        ref: 'refs/heads/main',
        repository: {full_name: 'shipfox/platform'},
      },
    });
    const misses = evaluateTriggerFilter({
      subscription,
      source: 'github',
      event: 'push',
      payload: {
        ref: 'refs/heads/main',
        repository: {full_name: 'shipfox/docs'},
      },
    });

    expect(matches).toEqual({kind: 'matched'});
    expect(misses).toEqual({kind: 'filtered'});
  });

  test('returns filter-error when the stored filter cannot be parsed', () => {
    const subscription = subscriptionWithConfig({filter: 'event.ref =='});

    const result = evaluateTriggerFilter({
      subscription,
      source: 'github',
      event: 'push',
      payload: {ref: 'refs/heads/main'},
    });

    expect(result.kind).toBe('filter-error');
  });

  test('returns filter-error when filter evaluation throws', () => {
    const subscription = subscriptionWithConfig({filter: 'event.ref.size() > 1'});

    const result = evaluateTriggerFilter({
      subscription,
      source: 'github',
      event: 'push',
      payload: {},
    });

    expect(result).toEqual({kind: 'filter-error', reason: 'Trigger filter evaluation failed'});
  });

  test('returns filtered when the stored filter evaluates to a non-boolean value', () => {
    const subscription = subscriptionWithConfig({filter: 'event.ref'});

    const result = evaluateTriggerFilter({
      subscription,
      source: 'github',
      event: 'push',
      payload: {ref: 'refs/heads/main'},
    });

    expect(result).toEqual({kind: 'filtered'});
  });

  test.each([
    {name: 'blank', filter: '   '},
    {name: 'non-string', filter: ['event.ref == "refs/heads/main"']},
  ])('returns filter-error when the stored filter is $name', ({filter}) => {
    const subscription = subscriptionWithConfig({filter});

    const result = evaluateTriggerFilter({
      subscription,
      source: 'github',
      event: 'push',
      payload: {ref: 'refs/heads/main'},
    });

    expect(result).toEqual({
      kind: 'filter-error',
      reason: 'Trigger subscription filter must be a non-empty string when set',
    });
  });
});
