const CURSOR_SEPARATOR = '|';

export interface TimestampIdCursor {
  createdAt: Date;
  id: string;
}

export interface StringIdCursor {
  value: string;
  id: string;
}

export function encodeTimestampIdCursor(cursor: TimestampIdCursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}${CURSOR_SEPARATOR}${cursor.id}`).toString(
    'base64url',
  );
}

export function decodeTimestampIdCursor(cursor: string | undefined): TimestampIdCursor | undefined {
  if (!cursor) return undefined;
  const decoded = decodeCursor(cursor);
  if (!decoded) return undefined;
  const [createdAtRaw, id, ...extra] = decoded.split(CURSOR_SEPARATOR);
  if (!createdAtRaw || !id || extra.length > 0) return undefined;
  const createdAt = new Date(createdAtRaw);
  if (Number.isNaN(createdAt.getTime())) return undefined;
  return {createdAt, id};
}

export function encodeStringIdCursor(cursor: StringIdCursor): string {
  return Buffer.from(`${cursor.value}${CURSOR_SEPARATOR}${cursor.id}`).toString('base64url');
}

export function decodeStringIdCursor(cursor: string | undefined): StringIdCursor | undefined {
  if (!cursor) return undefined;
  const decoded = decodeCursor(cursor);
  if (!decoded) return undefined;
  const [value, id, ...extra] = decoded.split(CURSOR_SEPARATOR);
  if (!value || !id || extra.length > 0) return undefined;
  return {value, id};
}

function decodeCursor(cursor: string): string | undefined {
  try {
    return Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    return undefined;
  }
}
