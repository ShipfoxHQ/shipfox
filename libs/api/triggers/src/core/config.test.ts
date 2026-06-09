import {readConfigInputs} from './config.js';
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
