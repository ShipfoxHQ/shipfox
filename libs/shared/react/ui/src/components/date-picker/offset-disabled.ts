import {differenceInCalendarDays} from 'date-fns';

/**
 * Builds a `react-day-picker` matcher that disables any day more than
 * `maxOffsetDays` calendar days before or after `reference`. The boundary is
 * inclusive, so the day exactly `maxOffsetDays` away stays selectable.
 *
 * Comparison is by calendar day (not elapsed time), so the `reference`'s
 * time-of-day never shifts the window by a day.
 *
 * Returns `undefined` when `maxOffsetDays` is unset, meaning no day is
 * disabled. `0` is a valid bound that restricts selection to `reference` only.
 */
export function buildOffsetDisabledMatcher({
  reference,
  maxOffsetDays,
}: {
  reference: Date;
  maxOffsetDays: number | undefined;
}): ((date: Date) => boolean) | undefined {
  if (maxOffsetDays === undefined) return undefined;
  return (date: Date) => Math.abs(differenceInCalendarDays(date, reference)) > maxOffsetDays;
}
