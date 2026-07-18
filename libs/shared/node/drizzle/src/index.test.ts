import * as publicApi from './index.js';

describe('@shipfox/node-drizzle public exports', () => {
  it('exposes only the supported runtime API', () => {
    expect(Object.keys(publicApi).sort()).toEqual([
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
      'timestampIdCursorWhere',
      'uuidv7PrimaryKey',
    ]);
  });
});
