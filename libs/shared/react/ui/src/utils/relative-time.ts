import {intlFormatDistance} from 'date-fns';

export type RelativeNow = Date | number | string;

function timestamp(value: RelativeNow): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return Date.parse(value);
}

/**
 * Formats the signed distance between `iso` and now as a short relative
 * string ("12s ago", "3m ago", "in 2h"). Returns '' for unparseable input
 * so callers can render an empty placeholder instead of letting a thrown
 * `Intl` call leak out.
 *
 * Under `reducedMotion`, sub-minute distances collapse to a steady
 * "just now" / "in <1m" rather than ticking every second.
 */
export function formatRelative(
  iso: string,
  {reducedMotion, now}: {reducedMotion: boolean; now?: RelativeNow},
): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const nowTs = now === undefined ? Date.now() : timestamp(now);
  if (!Number.isFinite(nowTs)) return '';
  const diffMs = nowTs - ts;
  const past = diffMs >= 0;
  const absMs = Math.abs(diffMs);

  if (absMs < 60_000) {
    if (reducedMotion) return past ? 'just now' : 'in <1m';
  }

  return intlFormatDistance(new Date(ts), nowTs, {
    numeric: 'always',
    style: 'narrow',
  });
}
