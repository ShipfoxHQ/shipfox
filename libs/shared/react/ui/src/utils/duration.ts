/**
 * Renders a short, human-readable duration like `13s`, `2m 14s`, `1h 03m`.
 *
 * Used on Run rows to show wall-clock duration ("13s" for terminal runs,
 * "running 12s" elsewhere). Tabular numerals are already enabled at the
 * `html` level, so digits don't jitter on update.
 */
export function humanDuration(fromIso: string, toIso?: string): string {
  const from = Date.parse(fromIso);
  const to = toIso ? Date.parse(toIso) : Date.now();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return '';
  const ms = Math.max(0, to - from);
  const totalSec = Math.floor(ms / 1000);

  if (totalSec < 60) return `${totalSec}s`;

  const totalMin = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (totalMin < 60) return `${totalMin}m ${pad2(sec)}s`;

  const totalHr = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return `${totalHr}h ${pad2(min)}m`;
}

function pad2(n: number) {
  return n.toString().padStart(2, '0');
}

/**
 * Formats a millisecond span as a short human string ("412ms", "2.1s", "1m 3s",
 * "1h 2m"). Use this for a precise duration value (a step or log group's elapsed
 * time); for wall-clock between two timestamps at second granularity use
 * `humanDuration`. Negative or non-finite input collapses to "0ms".
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0ms';
  if (ms < 1000) {
    // A fractional value just under 1000 rounds up; carry it to "1s" rather than "1000ms".
    const roundedMs = Math.round(ms);
    return roundedMs < 1000 ? `${roundedMs}ms` : '1s';
  }

  // Below a minute, keep one decimal of seconds. Round there and carry to "1m" if
  // it reaches 60.0 (e.g. 59_999ms) so we never render "60s".
  if (ms < 60_000) {
    const seconds = Math.round(ms / 100) / 10;
    if (seconds < 60) return `${seconds}s`;
    return '1m';
  }

  // Round to whole seconds once, up front, then split. Rounding the remainder in
  // place could push it to 60 ("1m 60s", "59m 60s"); carrying through whole
  // seconds keeps every tier in range.
  const totalSeconds = Math.round(ms / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const seconds = totalSeconds - totalMinutes * 60;
    return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes - hours * 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}
