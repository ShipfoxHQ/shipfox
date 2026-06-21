/**
 * Formats the signed distance between `iso` and now as a short relative
 * string ("12s ago", "3m ago", "in 2h"). Returns '' for unparseable input
 * so callers can render an empty placeholder instead of letting a thrown
 * `Intl` call leak out.
 *
 * Under `reducedMotion`, sub-minute distances collapse to a steady
 * "just now" / "in <1m" rather than ticking every second.
 */
export function formatRelative(iso: string, {reducedMotion}: {reducedMotion: boolean}): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const diffMs = Date.now() - ts;
  const past = diffMs >= 0;
  const absMs = Math.abs(diffMs);

  if (absMs < 60_000) {
    if (reducedMotion) return past ? 'just now' : 'in <1m';
    const sec = Math.max(0, Math.floor(absMs / 1000));
    return past ? `${sec}s ago` : `in ${sec}s`;
  }
  if (absMs < 3_600_000) {
    const min = Math.floor(absMs / 60_000);
    return past ? `${min}m ago` : `in ${min}m`;
  }
  if (absMs < 86_400_000) {
    const hr = Math.floor(absMs / 3_600_000);
    return past ? `${hr}h ago` : `in ${hr}h`;
  }
  const day = Math.floor(absMs / 86_400_000);
  return past ? `${day}d ago` : `in ${day}d`;
}
