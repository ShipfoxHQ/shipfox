import {readConfigInputs, readConfigOn} from './config.js';
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

describe('readConfigOn', () => {
  test('passes through a string', () => {
    const on = readConfigOn(subscriptionWithConfig({on: 'main'}));

    expect(on).toBe('main');
  });

  test('passes through a string array', () => {
    const on = readConfigOn(subscriptionWithConfig({on: ['main', 'develop']}));

    expect(on).toEqual(['main', 'develop']);
  });

  test('returns undefined when missing', () => {
    const on = readConfigOn(subscriptionWithConfig({}));

    expect(on).toBeUndefined();
  });

  test('returns undefined when array contains a non-string', () => {
    const on = readConfigOn(subscriptionWithConfig({on: ['main', 42]}));

    expect(on).toBeUndefined();
  });

  test('returns undefined when not a string or array', () => {
    const on = readConfigOn(subscriptionWithConfig({on: {branch: 'main'}}));

    expect(on).toBeUndefined();
  });
});
