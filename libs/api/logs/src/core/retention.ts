import {logger} from '@shipfox/node-opentelemetry';
import {deleteObjectsByPrefix} from '#api/object-storage.js';
import {config} from '#config.js';
import {logObjectKey} from '#core/entities/log-object.js';
import {deleteJobAccounting} from '#db/accounting.js';
import {db} from '#db/db.js';
import {
  accountingHasNoStreams,
  deleteExpiredStream,
  listExpiredClosedStreams,
} from '#db/streams.js';

export interface RetentionSweepResult {
  /** Streams whose row was deleted; their objects are reclaimed after (a rare object-cleanup failure is logged). */
  deleted: number;
  /** Streams skipped because compaction changed `object_key` after we read it (retried next run). */
  raced: number;
  /** Streams whose guarded row delete threw; logged, skipped, and retried next run. */
  failed: number;
  accountingPruned: number;
  iterations: number;
  /** True when the sweep stopped on its wall-clock budget with backlog likely remaining. */
  timedOut: boolean;
}

export interface RunRetentionSweepParams {
  retentionDays: number;
  batchLimit: number;
  timeBudgetMs: number;
  maxIterations: number;
  /** Wall clock; injectable so tests can drive the time budget deterministically. */
  now?: () => number;
  /** Liveness signal (e.g. the activity heartbeat); invoked once per processed stream. */
  onProgress?: () => void;
}

/**
 * Deletes expired closed streams (objects + rows) and prunes each emptied job's accounting row.
 *
 * Drains in keyset-paginated batches until the backlog is exhausted, a self-imposed wall-clock
 * budget elapses, or `maxIterations` is hit. The budget matters because a Temporal
 * `startToCloseTimeout` marks the activity failed but does NOT kill this loop; stopping
 * ourselves well before it keeps a timed-out attempt from deleting alongside the next cron run.
 * The budget and the liveness heartbeat are both checked per stream, not once per batch, so a
 * slow batch cannot overrun the budget or trip the heartbeat timeout.
 *
 * Per stream, in order: a guarded row delete keyed on the observed `object_key` (a compaction
 * publish landing after the select changes the key, so the delete matches 0 rows and the row is
 * left for the next run), then — only once the row is gone — delete the whole attempt object
 * prefix (the recorded object plus any leaves a losing compaction attempt left). Deleting objects
 * only after the guard wins is what keeps a racing publish's object from being wiped while its row
 * survives; the cost is that an object-delete failure after the row is gone leaks an orphan of an
 * already-expired stream (storage-only, never a dangling row). One stream's row-delete failure is
 * logged and skipped so it cannot abort the batch; the skip-set keeps it out of later selects this
 * run, so the younger healthy streams behind it are not starved (it retries on the next run).
 */
export async function runRetentionSweep(
  params: RunRetentionSweepParams,
): Promise<RetentionSweepResult> {
  const now = params.now ?? Date.now;
  const deadline = now() + params.timeBudgetMs;
  const result: RetentionSweepResult = {
    deleted: 0,
    raced: 0,
    failed: 0,
    accountingPruned: 0,
    iterations: 0,
    timedOut: false,
  };

  // Ids that failed or raced this run; excluded from later selects so they do not re-sort to
  // the front and starve the healthy streams behind them. They retry on the next run.
  const skip = new Set<string>();
  while (result.iterations < params.maxIterations) {
    if (now() >= deadline) {
      result.timedOut = true;
      break;
    }

    const batch = await listExpiredClosedStreams({
      retentionDays: params.retentionDays,
      limit: params.batchLimit,
      excludeIds: skip.size > 0 ? [...skip] : undefined,
    });
    if (batch.length === 0) break;

    let timedOutMidBatch = false;
    for (const stream of batch) {
      // Heartbeat and check the time budget per stream, not once per batch: a slow batch must not
      // trip the heartbeat timeout or overrun the budget into the next cron run. A single stream's
      // work is bounded (the fail-fast S3 client caps each call), so per-stream keeps both inside
      // their limits.
      params.onProgress?.();
      if (now() >= deadline) {
        result.timedOut = true;
        timedOutMidBatch = true;
        break;
      }

      let outcome: {deleted: boolean; prunedAccounting: boolean};
      try {
        outcome = await db().transaction(async (tx) => {
          const {deleted, jobId} = await deleteExpiredStream(tx, {
            streamId: stream.id,
            observedObjectKey: stream.objectKey,
          });
          if (deleted && jobId && (await accountingHasNoStreams(tx, jobId))) {
            const pruned = await deleteJobAccounting(tx, {
              jobId,
              retentionDays: params.retentionDays,
            });
            return {deleted, prunedAccounting: pruned.deleted};
          }
          return {deleted, prunedAccounting: false};
        });
      } catch (error) {
        result.failed += 1;
        skip.add(stream.id);
        logger().error(
          {err: error, streamId: stream.id},
          'Failed to delete expired log stream row',
        );
        continue;
      }

      if (!outcome.deleted) {
        // `object_key` changed since the select: a compaction publish landed, so its object stays.
        // Leave the row for the next run, which re-reads the fresh key.
        result.raced += 1;
        skip.add(stream.id);
        continue;
      }

      result.deleted += 1;
      if (outcome.prunedAccounting) result.accountingPruned += 1;

      // The guarded row delete won, so no newer publish exists under this prefix: reclaim the whole
      // attempt prefix (recorded object plus any orphan leaves). A failure here only leaks an orphan
      // of an already-deleted expired stream; the row is gone, so there is nothing to retry.
      try {
        await deleteObjectsByPrefix(`${logObjectKey(config.LOG_STORAGE_S3_PREFIX, stream)}/`);
      } catch (error) {
        logger().error(
          {err: error, streamId: stream.id},
          'Deleted expired stream row but failed to delete its objects',
        );
      }
    }

    if (timedOutMidBatch) break;

    result.iterations += 1;
    if (batch.length < params.batchLimit) break;
  }

  return result;
}
