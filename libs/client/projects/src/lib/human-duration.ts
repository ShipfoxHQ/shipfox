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

export function humanDurationMs(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  const totalSec = Math.floor(Math.max(0, ms) / 1000);

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
