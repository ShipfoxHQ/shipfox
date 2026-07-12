import {
  decodeNumberIdCursor,
  decodeStringIdCursor,
  decodeTimestampIdCursor,
  drizzle,
  encodeNumberIdCursor,
  encodeStringIdCursor,
  encodeTimestampIdCursor,
  type NodePgDatabase,
  paginateTimestampIdRows,
  runMigrations,
  timestampIdCursorWhere,
  uuidv7PrimaryKey,
} from '@shipfox/node-drizzle';

const timestampCursor = {createdAt: new Date('2026-07-12T12:00:00.000Z'), id: 'row-1'};
const timestampRows = [{...timestampCursor}];

const results = {
  number: decodeNumberIdCursor(encodeNumberIdCursor({value: 1, id: 'row-1'})),
  string: decodeStringIdCursor(encodeStringIdCursor({value: 'alpha', id: 'row-1'})),
  timestamp: decodeTimestampIdCursor(encodeTimestampIdCursor(timestampCursor)),
  page: paginateTimestampIdRows({rows: timestampRows, limit: 1, timestampKey: 'createdAt'}),
  primaryKey: uuidv7PrimaryKey(),
};

function acceptsDatabase(database: NodePgDatabase): NodePgDatabase {
  return database;
}

void acceptsDatabase;
void drizzle;
void runMigrations;
void timestampIdCursorWhere;

if (!results.primaryKey || results.number?.value !== 1) {
  throw new Error('Public helpers returned an unexpected result');
}
