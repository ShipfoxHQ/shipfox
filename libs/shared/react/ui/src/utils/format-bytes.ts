const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * Formats a byte count as a short human string ("512 B", "1.2 KB", "3 MB"). Uses
 * binary (1024) steps, one decimal below 100 in a unit and none above. Negative or
 * non-finite input collapses to "0 B".
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  if (unit === 0) return `${Math.round(value)} ${UNITS[unit]}`;

  let rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  // Rounding can push the value to a full 1024 of its unit (1_048_575 → "1024 KB");
  // carry into the next unit so we never render "1024 KB" next to "1 MB".
  if (rounded >= 1024 && unit < UNITS.length - 1) {
    rounded = 1;
    unit += 1;
  }
  return `${rounded} ${UNITS[unit]}`;
}
