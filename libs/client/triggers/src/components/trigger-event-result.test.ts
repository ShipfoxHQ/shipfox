import {triggerEventResult} from './trigger-event-result.js';

describe('triggerEventResult', () => {
  test('routed reads as triggered workflows and pluralizes', () => {
    expect(triggerEventResult({outcome: 'routed', matched_count: 2}).label).toBe(
      'Triggered 2 workflows',
    );
    expect(triggerEventResult({outcome: 'routed', matched_count: 1}).label).toBe(
      'Triggered 1 workflow',
    );
  });

  test('routed uses the info badge and is not failed', () => {
    const result = triggerEventResult({outcome: 'routed', matched_count: 1});

    expect(result.badge).toBe('info');
    expect(result.failed).toBe(false);
  });

  test('discarded reads as no workflows triggered', () => {
    const result = triggerEventResult({outcome: 'discarded', matched_count: 0});

    expect(result.label).toBe('No workflows triggered');
    expect(result.badge).toBe('neutral');
  });

  test('failed and errored read as failed with the error badge', () => {
    for (const outcome of ['failed', 'errored'] as const) {
      const result = triggerEventResult({outcome, matched_count: 1});

      expect(result.label).toBe('Failed');
      expect(result.badge).toBe('error');
      expect(result.failed).toBe(true);
    }
  });

  test('received reads as evaluating', () => {
    expect(triggerEventResult({outcome: 'received', matched_count: 0}).label).toBe('Evaluating…');
  });
});
