const UNIT_MS = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

const DURATION_PATTERN = /^(\d+)([smhd])$/;

/** Parses a duration such as `90s` into milliseconds. */
export function parseDuration(text) {
  const match = DURATION_PATTERN.exec(text.trim());
  if (match === null) throw new Error(`Invalid duration: ${text}`);
  return Number(match[1]) * UNIT_MS[match[2]];
}
