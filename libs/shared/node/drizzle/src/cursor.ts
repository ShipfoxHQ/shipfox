export interface TimestampIdCursor {
  createdAt: Date;
  id: string;
}

export interface StringIdCursor {
  value: string;
  id: string;
}

export function encodeTimestampIdCursor(cursor: TimestampIdCursor): string {
  return encode({createdAt: cursor.createdAt.toISOString(), id: cursor.id});
}

export function decodeTimestampIdCursor(cursor: string | undefined): TimestampIdCursor | undefined {
  const parsed = decode(cursor);
  if (!parsed) return undefined;
  const {createdAt: createdAtRaw, id} = parsed;
  if (typeof createdAtRaw !== 'string' || typeof id !== 'string' || !id) return undefined;
  const createdAt = new Date(createdAtRaw);
  if (Number.isNaN(createdAt.getTime())) return undefined;
  return {createdAt, id};
}

export function encodeStringIdCursor(cursor: StringIdCursor): string {
  return encode({value: cursor.value, id: cursor.id});
}

export function decodeStringIdCursor(cursor: string | undefined): StringIdCursor | undefined {
  const parsed = decode(cursor);
  if (!parsed) return undefined;
  const {value, id} = parsed;
  if (typeof value !== 'string' || typeof id !== 'string' || !id) return undefined;
  return {value, id};
}

function encode(payload: Record<string, string>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decode(cursor: string | undefined): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
