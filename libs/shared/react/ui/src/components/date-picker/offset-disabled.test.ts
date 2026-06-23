import {buildOffsetDisabledMatcher} from './offset-disabled.js';

describe('buildOffsetDisabledMatcher', () => {
  // Afternoon reference: proves the matcher ignores time-of-day and compares
  // calendar days, so the past boundary day is not wrongly disabled.
  const reference = new Date(2025, 5, 15, 14, 30);

  it('returns undefined when maxOffsetDays is unset', () => {
    const matcher = buildOffsetDisabledMatcher({reference, maxOffsetDays: undefined});

    expect(matcher).toBeUndefined();
  });

  it('treats 0 as a real bound that restricts selection to the reference day', () => {
    const matcher = buildOffsetDisabledMatcher({reference, maxOffsetDays: 0});

    expect(matcher?.(new Date(2025, 5, 15))).toBe(false);
    expect(matcher?.(new Date(2025, 5, 14))).toBe(true);
    expect(matcher?.(new Date(2025, 5, 16))).toBe(true);
  });

  it('keeps the day exactly maxOffsetDays away selectable (inclusive boundary)', () => {
    const matcher = buildOffsetDisabledMatcher({reference, maxOffsetDays: 7});

    expect(matcher?.(new Date(2025, 5, 8))).toBe(false);
    expect(matcher?.(new Date(2025, 5, 22))).toBe(false);
  });

  it('disables days beyond the window on both sides', () => {
    const matcher = buildOffsetDisabledMatcher({reference, maxOffsetDays: 7});

    expect(matcher?.(new Date(2025, 5, 7))).toBe(true);
    expect(matcher?.(new Date(2025, 5, 23))).toBe(true);
  });

  it('does not shift the boundary when the candidate has a time component', () => {
    const matcher = buildOffsetDisabledMatcher({reference, maxOffsetDays: 7});

    expect(matcher?.(new Date(2025, 5, 8, 23, 59))).toBe(false);
    expect(matcher?.(new Date(2025, 5, 22, 0, 1))).toBe(false);
  });
});
