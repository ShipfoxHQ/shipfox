import {assertRetentionDaysWithinBounds} from './config.js';

describe('assertRetentionDaysWithinBounds', () => {
  test('accepts a retention window of at least one day', () => {
    expect(() => assertRetentionDaysWithinBounds(7)).not.toThrow();
    expect(() => assertRetentionDaysWithinBounds(1)).not.toThrow();
  });

  test('rejects a zero window that would tombstone freshly created installs', () => {
    expect(() => assertRetentionDaysWithinBounds(0)).toThrow();
  });

  test('rejects a negative window that pushes the cutoff into the future', () => {
    expect(() => assertRetentionDaysWithinBounds(-7)).toThrow();
  });
});
