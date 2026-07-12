import * as publicApi from './index.js';

describe('@shipfox/node-outbox public exports', () => {
  it('exposes only the supported runtime API', () => {
    expect(Object.keys(publicApi).sort()).toEqual([
      'PostgresOutbox',
      'createOutboxTable',
      'createPostgresOutbox',
      'createPostgresOutboxTable',
      'writeIdempotentOutboxEvent',
      'writeOutboxEvent',
      'writeOutboxEvents',
    ]);
  });
});
