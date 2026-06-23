import {pruneDispatchedOutboxRows} from '@shipfox/node-module';
import {logger} from '@shipfox/node-opentelemetry';

const OUTBOX_RETENTION_DAYS = 7;
const OUTBOX_RETENTION_BATCH_SIZE = 5_000;
const OUTBOX_RETENTION_MAX_BATCHES_PER_SOURCE = 200;

export async function pruneOutboxRetention(): Promise<void> {
  const results = await pruneDispatchedOutboxRows({
    retentionDays: OUTBOX_RETENTION_DAYS,
    batchSize: OUTBOX_RETENTION_BATCH_SIZE,
    maxBatchesPerSource: OUTBOX_RETENTION_MAX_BATCHES_PER_SOURCE,
  });

  logger().info(
    {
      retentionDays: OUTBOX_RETENTION_DAYS,
      batchSize: OUTBOX_RETENTION_BATCH_SIZE,
      maxBatchesPerSource: OUTBOX_RETENTION_MAX_BATCHES_PER_SOURCE,
      sources: results,
    },
    'Pruned dispatched outbox rows',
  );
}
