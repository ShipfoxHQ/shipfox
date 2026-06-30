export const MEMORY_PATTERN = /^\d+(\.\d+)?\s*(b|kb|mb|gb|tb|kib|mib|gib|tib|k|m|g|t)?$/i;
const MEMORY_PARTS_PATTERN = /^(\d+(?:\.\d+)?)\s*([a-z]+)?$/i;

const UNITS: Record<string, number> = {
  b: 1,
  k: 1024,
  kb: 1024,
  kib: 1024,
  m: 1024 ** 2,
  mb: 1024 ** 2,
  mib: 1024 ** 2,
  g: 1024 ** 3,
  gb: 1024 ** 3,
  gib: 1024 ** 3,
  t: 1024 ** 4,
  tb: 1024 ** 4,
  tib: 1024 ** 4,
};

export function parseMemoryToBytes(memory: string): number {
  const match = memory.trim().match(MEMORY_PARTS_PATTERN);
  if (!match) {
    throw new Error(`Invalid Docker memory value: ${memory}.`);
  }

  const value = Number(match[1]);
  const unit = match[2]?.toLowerCase() ?? 'b';
  const multiplier = UNITS[unit];
  if (!Number.isFinite(value) || multiplier === undefined) {
    throw new Error(`Invalid Docker memory value: ${memory}.`);
  }

  return Math.floor(value * multiplier);
}
