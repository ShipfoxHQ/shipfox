export type LogTimestampMode = 'off' | 'rel' | 'abs';

const absoluteFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * Formats a row's time for the gutter column.
 *
 * `abs` renders the wall-clock `HH:MM:SS`. `rel` renders a signed offset from
 * `timestampOrigin` (`+0.412`, `+1:05.300`); without one there is no baseline to
 * subtract, so it falls back to the absolute clock rather than render blank.
 * `off` returns '' because the column is hidden upstream.
 */
export function formatLogTimestamp(
  date: Date,
  {mode, timestampOrigin}: {mode: LogTimestampMode; timestampOrigin?: Date | undefined},
): string {
  if (mode === 'off') return '';
  if (mode === 'rel' && timestampOrigin) {
    return formatOffset(date.getTime() - timestampOrigin.getTime());
  }
  return absoluteFormatter.format(date);
}

/** Flips the visible timestamp unit (relative ↔ absolute); leaves `off` unchanged. */
export function toggleTimestampUnit(mode: LogTimestampMode): LogTimestampMode {
  if (mode === 'rel') return 'abs';
  if (mode === 'abs') return 'rel';
  return mode;
}

function formatOffset(deltaMs: number): string {
  const sign = deltaMs < 0 ? '-' : '+';
  const totalSeconds = Math.abs(deltaMs) / 1000;

  if (totalSeconds < 60) return `${sign}${totalSeconds.toFixed(3)}`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(3).padStart(6, '0');
  if (minutes < 60) return `${sign}${minutes}:${seconds}`;

  const hours = Math.floor(minutes / 60);
  const mins = String(minutes % 60).padStart(2, '0');
  return `${sign}${hours}:${mins}:${seconds}`;
}
