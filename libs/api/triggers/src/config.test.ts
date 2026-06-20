import {assertRetentionDaysWithinBounds} from './config.js';

const RETENTION_ERROR = /TRIGGER_EVENT_RETENTION_DAYS/;

describe('assertRetentionDaysWithinBounds', () => {
  test.each([1, 30, 365])('accepts a finite window of at least 1 day (%p)', (days) => {
    expect(() => assertRetentionDaysWithinBounds(days)).not.toThrow();
  });

  test.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects a window below 1 day or non-finite (%p)', (days) => {
    expect(() => assertRetentionDaysWithinBounds(days)).toThrow(RETENTION_ERROR);
  });
});
