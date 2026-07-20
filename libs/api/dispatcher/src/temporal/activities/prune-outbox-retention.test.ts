import type {OutboxRegistry} from '@shipfox/node-module';
import {pruneOutboxRetention} from './prune-outbox-retention.js';

const mocks = vi.hoisted(() => ({
  pruneDispatchedOutboxRows: vi.fn(),
  infoLog: vi.fn(),
}));
const outboxRegistry = {} as OutboxRegistry;

vi.mock('@shipfox/node-module', () => ({
  pruneDispatchedOutboxRows: mocks.pruneDispatchedOutboxRows,
}));

vi.mock('@shipfox/node-opentelemetry', () => ({
  logger: () => ({
    info: mocks.infoLog,
  }),
}));

describe('pruneOutboxRetention', () => {
  beforeEach(() => {
    mocks.pruneDispatchedOutboxRows.mockReset();
    mocks.infoLog.mockReset();
  });

  it('prunes dispatched outbox rows with the fixed retention policy', async () => {
    const sources = [
      {source: 'definitions', deleted: 2, capped: false},
      {source: 'workflows', deleted: 5_000, capped: true},
    ];
    mocks.pruneDispatchedOutboxRows.mockResolvedValueOnce(sources);

    await pruneOutboxRetention(outboxRegistry);

    expect(mocks.pruneDispatchedOutboxRows).toHaveBeenCalledWith(outboxRegistry, {
      retentionDays: 7,
      batchSize: 5_000,
      maxBatchesPerSource: 200,
    });
    expect(mocks.infoLog).toHaveBeenCalledWith(
      {
        retentionDays: 7,
        batchSize: 5_000,
        maxBatchesPerSource: 200,
        sources,
      },
      'Pruned dispatched outbox rows',
    );
  });
});
