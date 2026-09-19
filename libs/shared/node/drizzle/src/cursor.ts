import {and, eq, lt, or, type SQL, type SQLWrapper, sql} from 'drizzle-orm';

const preciseTimestampValues = new WeakMap<Date, string>();
const utcTimestampPattern =
  /^(?<seconds>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(?<fraction>\d{1,6}))?Z$/;

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

export interface NumberIdCursor {
  value: number;
  id: string;
}

export function createTimestampIdCursor(cursor: {
  createdAt: Date | string;
  id: string;
}): TimestampIdCursor {
  const createdAt =
    typeof cursor.createdAt === 'string' ? new Date(cursor.createdAt) : cursor.createdAt;
  if (Number.isNaN(createdAt.getTime())) throw new TypeError('Invalid cursor timestamp');
  const timestamp =
    typeof cursor.createdAt === 'string'
      ? preciseUtcTimestamp(cursor.createdAt, createdAt)
      : cursor.createdAt.toISOString();
  preciseTimestampValues.set(createdAt, timestamp);
  return {createdAt, id: cursor.id} satisfies TimestampIdCursor;
}

function preciseUtcTimestamp(value: string, parsed: Date): string {
  const match = utcTimestampPattern.exec(value);
  if (!match?.groups) return parsed.toISOString();
  const fraction = match.groups.fraction ?? '';
  const millisecondTimestamp = `${match.groups.seconds}.${fraction.padEnd(3, '0').slice(0, 3)}Z`;
  return parsed.toISOString() === millisecondTimestamp ? value : parsed.toISOString();
}

export function timestampIdCursorTimestamp(cursor: TimestampIdCursor): string {
  return preciseTimestampValues.get(cursor.createdAt) ?? cursor.createdAt.toISOString();
}

export function timestampIdCursorColumn(timestampColumn: SQLWrapper): SQL<string> {
  return sql<string>`to_char(
    ${timestampColumn} at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
  )`;
}

export function encodeTimestampIdCursor(cursor: TimestampIdCursor): string {
  return encode({createdAt: timestampIdCursorTimestamp(cursor), id: cursor.id});
}

export function decodeTimestampIdCursor(cursor: string | undefined): TimestampIdCursor | undefined {
  const parsed = decode(cursor);
  if (!parsed) return undefined;
  const {createdAt: createdAtRaw, id} = parsed;
  if (typeof createdAtRaw !== 'string' || typeof id !== 'string' || !id) return undefined;
  const createdAt = new Date(createdAtRaw);
  if (Number.isNaN(createdAt.getTime())) return undefined;
  return createTimestampIdCursor({createdAt: createdAtRaw, id});
}

export function timestampIdCursorWhere(params: {
  timestampColumn: SQLWrapper;
  idColumn: SQLWrapper;
  cursor: TimestampIdCursor | undefined;
}): SQL | undefined {
  const {timestampColumn, idColumn, cursor} = params;
  if (!cursor) return undefined;
  const cursorTimestamp = sql`${timestampIdCursorTimestamp(cursor)}::timestamptz`;
  return or(
    lt(timestampColumn, cursorTimestamp),
    and(eq(timestampColumn, cursorTimestamp), lt(idColumn, cursor.id)),
  );
}

export function paginateTimestampIdRows<
  TTimestampKey extends string,
  TRow extends {id: string} & Record<TTimestampKey, Date>,
>(params: {
  rows: TRow[];
  limit: number;
  timestampKey: TTimestampKey;
  cursorTimestamp?: (row: TRow) => string;
}): TimestampIdPage<TRow> {
  const hasMore = params.rows.length > params.limit;
  const pageRows = hasMore ? params.rows.slice(0, params.limit) : params.rows;
  const last = pageRows.at(-1);

  return {
    pageRows,
    nextCursor:
      hasMore && last
        ? createTimestampIdCursor({
            createdAt: params.cursorTimestamp?.(last) ?? last[params.timestampKey],
            id: last.id,
          })
        : null,
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

export function encodeNumberIdCursor(cursor: NumberIdCursor): string {
  return encode({value: String(cursor.value), id: cursor.id});
}

export function decodeNumberIdCursor(cursor: string | undefined): NumberIdCursor | undefined {
  const parsed = decode(cursor);
  if (!parsed) return undefined;
  const {value, id} = parsed;
  if (typeof value !== 'string' || typeof id !== 'string' || !id) return undefined;
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 1) return undefined;
  return {value: numericValue, id};
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
