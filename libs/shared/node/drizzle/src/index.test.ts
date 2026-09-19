import * as publicApi from './index.js';

describe('@shipfox/node-drizzle public exports', () => {
  it('exposes only the supported runtime API', () => {
    expect(Object.keys(publicApi).sort()).toEqual([
      'createTimestampIdCursor',
      'decodeNumberIdCursor',
      'decodeStringIdCursor',
      'decodeTimestampIdCursor',
      'drizzle',
      'encodeNumberIdCursor',
      'encodeStringIdCursor',
      'encodeTimestampIdCursor',
      'isUniqueViolation',
      'paginateTimestampIdRows',
      'runMigrations',
      'timestampIdCursorColumn',
      'timestampIdCursorTimestamp',
      'timestampIdCursorWhere',
      'uuidv7PrimaryKey',
    ]);
  });
});
