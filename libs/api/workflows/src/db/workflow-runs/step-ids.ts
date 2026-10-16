import {randomBytes} from 'node:crypto';

/**
 * Gives each step row its id before the insert, so an inner step of a composite action names its
 * composite's row in the same statement. Positions are unique within a job execution.
 */
export function withStepIds<
  Row extends {readonly position: number; readonly parentPosition: number | null},
>(
  rows: readonly Row[],
): (Omit<Row, 'parentPosition'> & {id: string; parentStepId: string | null})[] {
  const idByPosition = new Map(rows.map((row) => [row.position, uuidv7()] as const));
  return rows.map(({parentPosition, ...row}) => {
    const id = idByPosition.get(row.position);
    if (id === undefined) throw new Error(`Step row at position ${row.position} has no id`);
    const parentStepId = parentPosition === null ? null : idByPosition.get(parentPosition);
    if (parentStepId === undefined) {
      throw new Error(`Step row at position ${row.position} has no composite row`);
    }
    return {...row, id, parentStepId};
  });
}

const UUID_VERSION_7 = 0x70;
const UUID_VARIANT_RFC_9562 = 0x80;

// The same time-ordered layout as the table's `uuidv7()` default: a 48-bit millisecond timestamp,
// then random bits around the version and variant.
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  let timestamp = now;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = timestamp % 256;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | UUID_VERSION_7;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | UUID_VARIANT_RFC_9562;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
