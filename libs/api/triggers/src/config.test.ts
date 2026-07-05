import {assertCronConfigWithinBounds, assertRetentionDaysWithinBounds} from './config.js';

const RETENTION_ERROR = /TRIGGER_EVENT_RETENTION_DAYS/;
const CRON_JITTER_ERROR = /TRIGGER_CRON_JITTER_WINDOW_SECONDS/;

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

describe('assertCronConfigWithinBounds', () => {
  test.each([0, 1, 60, 600])('accepts a finite non-negative jitter window (%p)', (seconds) => {
    expect(() => assertCronConfigWithinBounds(seconds)).not.toThrow();
  });

  test.each([
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects a negative or non-finite jitter window (%p)', (seconds) => {
    expect(() => assertCronConfigWithinBounds(seconds)).toThrow(CRON_JITTER_ERROR);
  });
});
