import type {RuntimeCommand} from '#core/runtime/runtime-command.js';
import {createOrchestrationActivities} from './activities/index.js';
import {
  durableExecutionHostActivityReference,
  durableExecutionHostCommandAdapterReference,
} from './durable-execution-host-reference.js';

const expectedCommandTypes = ['cancel_job', 'complete_run', 'start_job'] satisfies Array<
  RuntimeCommand['type']
>;

describe('durableExecutionHostCommandAdapterReference', () => {
  test('covers every runtime command type exactly once', () => {
    const commandTypes = durableExecutionHostCommandAdapterReference
      .map((reference) => reference.commandType)
      .sort();

    expect(commandTypes).toEqual(expectedCommandTypes);
    expect(new Set(commandTypes).size).toBe(commandTypes.length);
  });

  test('keeps every adapter row actionable for generated docs', () => {
    for (const reference of durableExecutionHostCommandAdapterReference) {
      expect(reference.temporalOperation.length).toBeGreaterThan(0);
      expect(reference.owner.length).toBeGreaterThan(0);
      expect(reference.persistenceSideEffect.length).toBeGreaterThan(0);
      expect(reference.currentLimitation.length).toBeGreaterThan(0);
    }
  });
});

describe('durableExecutionHostActivityReference', () => {
  test('covers every registered orchestration activity', () => {
    const documentedActivities = durableExecutionHostActivityReference
      .map((reference) => reference.name)
      .sort();
    const registeredActivities = Object.keys(createOrchestrationActivities()).sort();

    expect(documentedActivities).toEqual(registeredActivities);
  });
});
