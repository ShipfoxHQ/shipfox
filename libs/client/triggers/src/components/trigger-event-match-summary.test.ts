import {triggerEventMatchSummary} from './trigger-event-match-summary.js';

describe('triggerEventMatchSummary', () => {
  test('routed pluralizes the run count', () => {
    expect(triggerEventMatchSummary({outcome: 'routed', matched_count: 2})).toBe('→ 2 runs');
    expect(triggerEventMatchSummary({outcome: 'routed', matched_count: 1})).toBe('→ 1 run');
    expect(triggerEventMatchSummary({outcome: 'routed', matched_count: 0})).toBe('→ 0 runs');
  });

  test('discarded reads as no match', () => {
    expect(triggerEventMatchSummary({outcome: 'discarded', matched_count: 0})).toBe('No match');
  });

  test('failed and errored read as failed', () => {
    expect(triggerEventMatchSummary({outcome: 'failed', matched_count: 1})).toBe('Failed');
    expect(triggerEventMatchSummary({outcome: 'errored', matched_count: 0})).toBe('Failed');
  });

  test('received reads as evaluating', () => {
    expect(triggerEventMatchSummary({outcome: 'received', matched_count: 0})).toBe('Evaluating…');
  });
});
