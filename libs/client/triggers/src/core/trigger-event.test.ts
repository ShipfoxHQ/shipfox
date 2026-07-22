import {
  getTriggerEventResult,
  hasTriggerEventFilters,
  normalizeTriggerEventFilters,
  triggerEventResultFilterOutcomes,
} from './trigger-event.js';

describe('trigger event policies', () => {
  test('normalizes unordered duplicate filters for query identity', () => {
    const filters = normalizeTriggerEventFilters({
      source: ['github', 'gitea', 'github'],
      event: ['push', 'pull_request', 'push'],
      outcome: ['routed', 'failed', 'routed'],
    });

    expect(filters).toEqual({
      source: ['gitea', 'github'],
      event: ['pull_request', 'push'],
      outcome: ['failed', 'routed'],
      from: null,
      to: null,
    });
  });

  test('treats empty arrays as no active filters', () => {
    expect(hasTriggerEventFilters({source: [], event: [], outcome: []})).toBe(false);
  });

  test('preserves the failed result filter as both failure outcomes', () => {
    expect(triggerEventResultFilterOutcomes.failed).toEqual(['failed', 'errored']);
  });

  test('derives failure semantics without presentation details', () => {
    expect(getTriggerEventResult({outcome: 'errored', matchedCount: 1})).toEqual({
      kind: 'failed',
      matchedWorkflowCount: 1,
      isFailure: true,
    });
  });
});
