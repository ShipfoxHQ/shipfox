import {and, eq, lt, or, type SQL, type SQLWrapper} from 'drizzle-orm';

export interface TimestampIdCursor {
  createdAt: Date;
  id: string;
}

export interface TimestampIdPage<TRow> {
  pageRows: TRow[];
  nextCursor: TimestampIdCursor | null;
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

export function timestampIdCursorWhere(params: {
  timestampColumn: SQLWrapper;
  idColumn: SQLWrapper;
  cursor: TimestampIdCursor | undefined;
}): SQL | undefined {
  const {timestampColumn, idColumn, cursor} = params;
  if (!cursor) return undefined;
  return or(
    lt(timestampColumn, cursor.createdAt),
    and(eq(timestampColumn, cursor.createdAt), lt(idColumn, cursor.id)),
  );
}

export function paginateTimestampIdRows<
  TTimestampKey extends string,
  TRow extends {id: string} & Record<TTimestampKey, Date>,
>(params: {rows: TRow[]; limit: number; timestampKey: TTimestampKey}): TimestampIdPage<TRow> {
  const hasMore = params.rows.length > params.limit;
  const pageRows = hasMore ? params.rows.slice(0, params.limit) : params.rows;
  const last = pageRows.at(-1);

  return {
    pageRows,
    nextCursor: hasMore && last ? {createdAt: last[params.timestampKey], id: last.id} : null,
  };
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
