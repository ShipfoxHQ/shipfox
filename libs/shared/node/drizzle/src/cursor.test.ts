import {sql} from 'drizzle-orm';
import {
  decodeNumberIdCursor,
  decodeStringIdCursor,
  decodeTimestampIdCursor,
  encodeNumberIdCursor,
  encodeStringIdCursor,
  encodeTimestampIdCursor,
  paginateTimestampIdRows,
  timestampIdCursorWhere,
} from './cursor.js';

function encodeRaw(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

describe('timestamp cursors', () => {
  it('round-trips a timestamp and ID', () => {
    const cursor = {createdAt: new Date('2026-07-12T12:00:00.000Z'), id: 'run-1'};

    const decoded = decodeTimestampIdCursor(encodeTimestampIdCursor(cursor));

    expect(decoded).toEqual(cursor);
  });

  it.each([
    undefined,
    '',
    'not-json',
    encodeRaw([]),
    encodeRaw({createdAt: 'bad', id: 'run-1'}),
  ])('rejects an invalid cursor', (cursor) => {
    const decoded = decodeTimestampIdCursor(cursor);

    expect(decoded).toBeUndefined();
  });

  it('builds a keyset condition only when a cursor is present', () => {
    const timestampColumn = sql.raw('created_at');
    const idColumn = sql.raw('id');

    const absent = timestampIdCursorWhere({timestampColumn, idColumn, cursor: undefined});
    const present = timestampIdCursorWhere({
      timestampColumn,
      idColumn,
      cursor: {createdAt: new Date('2026-07-12T12:00:00.000Z'), id: 'run-1'},
    });

    expect(absent).toBeUndefined();
    expect(present).toBeDefined();
  });
});

describe('string cursors', () => {
  it('round-trips a string value and ID', () => {
    const cursor = {value: 'alpha', id: 'project-1'};

    const decoded = decodeStringIdCursor(encodeStringIdCursor(cursor));

    expect(decoded).toEqual(cursor);
  });

  it.each([
    undefined,
    '',
    'not-json',
    encodeRaw(null),
    encodeRaw({value: 1, id: 'project-1'}),
  ])('rejects an invalid cursor', (cursor) => {
    const decoded = decodeStringIdCursor(cursor);

    expect(decoded).toBeUndefined();
  });
});

describe('number cursors', () => {
  it('round-trips a positive integer and ID', () => {
    const cursor = {value: 42, id: 'annotation-1'};

    const decoded = decodeNumberIdCursor(encodeNumberIdCursor(cursor));

    expect(decoded).toEqual(cursor);
  });

  it.each([
    undefined,
    '',
    'not-json',
    encodeRaw({value: '0', id: 'annotation-1'}),
    encodeRaw({value: '1.5', id: 'annotation-1'}),
  ])('rejects an invalid cursor', (cursor) => {
    const decoded = decodeNumberIdCursor(cursor);

    expect(decoded).toBeUndefined();
  });
});

describe('paginateTimestampIdRows', () => {
  const rows = [
    {id: 'run-3', createdAt: new Date('2026-07-12T12:03:00.000Z')},
    {id: 'run-2', createdAt: new Date('2026-07-12T12:02:00.000Z')},
    {id: 'run-1', createdAt: new Date('2026-07-12T12:01:00.000Z')},
  ];

  it('returns the requested page and a cursor when another row exists', () => {
    const page = paginateTimestampIdRows({rows, limit: 2, timestampKey: 'createdAt'});

    expect(page).toEqual({
      pageRows: rows.slice(0, 2),
      nextCursor: {createdAt: rows[1]?.createdAt, id: 'run-2'},
    });
  });

  it('returns no cursor when all rows fit on the page', () => {
    const page = paginateTimestampIdRows({
      rows: rows.slice(0, 2),
      limit: 2,
      timestampKey: 'createdAt',
    });

    expect(page).toEqual({pageRows: rows.slice(0, 2), nextCursor: null});
  });
});
