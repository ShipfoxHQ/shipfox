/**
 * Formats an ISO timestamp as an absolute date and time in the user's
 * locale (e.g. "13 May 2026, 00:00"). Used to reveal the exact instant
 * behind a relative time string in a tooltip.
 */
export function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

/**
 * Formats an ISO timestamp as a locale date with no time component
 * (e.g. "13 May 2026"). Returns the raw input unchanged when it cannot be
 * parsed, so a malformed value degrades to something readable instead of
 * surfacing "Invalid Date".
 */
export function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return value;
  }
}
