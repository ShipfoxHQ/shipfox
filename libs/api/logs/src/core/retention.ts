import {logger} from '@shipfox/node-opentelemetry';
import {deleteObjectsByPrefix} from '#api/object-storage.js';
import {config} from '#config.js';
import type {AttemptStream} from '#core/entities/attempt-stream.js';
import {logObjectKey} from '#core/entities/log-object.js';
import {deleteJobAccounting} from '#db/accounting.js';
import {db} from '#db/db.js';
import {
  accountingHasNoStreams,
  deleteExpiredStream,
  getAttemptStreamById,
  listExpiredClosedStreams,
} from '#db/streams.js';

export interface RetentionSweepResult {
  /** Streams whose objects and row were deleted. */
  deleted: number;
  /** Streams skipped because compaction changed `object_key` after we read it (retried next run). */
  raced: number;
  /** Streams whose object cleanup or guarded row delete threw; logged, skipped, and retried next run. */
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

function deleteExpiredStreamObjects(stream: AttemptStream): Promise<void> {
  return deleteObjectsByPrefix(`${logObjectKey(config.LOG_STORAGE_S3_PREFIX, stream)}/`);
}

function deleteExpiredStreamRow(params: {
  stream: AttemptStream;
  retentionDays: number;
}): Promise<{deleted: boolean; prunedAccounting: boolean}> {
  return db().transaction(async (tx) => {
    const {deleted, jobId} = await deleteExpiredStream(tx, {
      streamId: params.stream.id,
      observedObjectKey: params.stream.objectKey,
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
}

/**
 * Deletes expired closed streams and prunes accounting for emptied jobs.
 *
 * The loop self-bounds because a Temporal `startToCloseTimeout` marks the activity failed but
 * does not stop already-running JS. Objects are deleted before rows so a cleanup failure leaves
 * the row discoverable for the next sweep; the row delete stays guarded on the observed
 * `object_key`, so a racing compaction publish is re-read before the row is removed.
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

  // Failed or raced rows retry next run; skipping them here keeps the rest of the backlog moving.
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
      // Per-stream checks keep long batches within the heartbeat and wall-clock budgets.
      params.onProgress?.();
      if (now() >= deadline) {
        result.timedOut = true;
        timedOutMidBatch = true;
        break;
      }

      try {
        await deleteExpiredStreamObjects(stream);
      } catch (error) {
        result.failed += 1;
        skip.add(stream.id);
        logger().error(
          {err: error, streamId: stream.id},
          'Failed to delete expired log stream objects',
        );
        continue;
      }

      let outcome: {deleted: boolean; prunedAccounting: boolean};
      try {
        outcome = await deleteExpiredStreamRow({stream, retentionDays: params.retentionDays});
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
        const current = await getAttemptStreamById(stream.id);
        if (current) {
          try {
            await deleteExpiredStreamObjects(current);
            outcome = await deleteExpiredStreamRow({
              stream: current,
              retentionDays: params.retentionDays,
            });
          } catch (error) {
            result.failed += 1;
            skip.add(stream.id);
            logger().error(
              {err: error, streamId: stream.id},
              'Failed to delete raced expired log stream',
            );
            continue;
          }
        }
        if (!current || !outcome.deleted) {
          // `object_key` changed again or the row disappeared; the next sweep will re-read it.
          result.raced += 1;
          skip.add(stream.id);
          continue;
        }
      }

      result.deleted += 1;
      if (outcome.prunedAccounting) result.accountingPruned += 1;
    }

    if (timedOutMidBatch) break;

    result.iterations += 1;
    if (batch.length < params.batchLimit) break;
  }

  return result;
}
