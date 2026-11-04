import * as publicApi from './index.js';

describe('@shipfox/node-drizzle public exports', () => {
  it('exposes only the supported runtime API', () => {
    expect(Object.keys(publicApi).sort()).toEqual([
      'ScopeDeletedError',
      'assertScopeWritable',
      'createTimestampIdCursor',
      'decodeNumberIdCursor',
      'decodeStringIdCursor',
      'decodeTimestampIdCursor',
      'deleteInBatches',
      'deletedScopeColumns',
      'drizzle',
      'encodeNumberIdCursor',
      'encodeStringIdCursor',
      'encodeTimestampIdCursor',
      'isUniqueViolation',
      'paginateTimestampIdRows',
      'recordDeletedScope',
      'runMigrations',
      'timestampIdCursorColumn',
      'timestampIdCursorTimestamp',
      'timestampIdCursorWhere',
      'uuidv7PrimaryKey',
    ]);
  });
});
