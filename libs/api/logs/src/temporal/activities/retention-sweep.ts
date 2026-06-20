import {Context} from '@temporalio/activity';
import {config} from '#config.js';
import {type RetentionSweepResult, runRetentionSweep} from '#core/retention.js';
import {
  RETENTION_BATCH_LIMIT,
  RETENTION_MAX_ITERATIONS,
  RETENTION_TIME_BUDGET_MS,
} from '#temporal/constants.js';

/**
 * Cron-driven sweep for expired closed log streams. Heartbeats per stream; the core loop owns
 * the wall-clock budget because Temporal timeouts do not stop already-running JS.
 */
export function retentionSweepActivity(): Promise<RetentionSweepResult> {
  const ctx = Context.current();
  return runRetentionSweep({
    retentionDays: config.LOG_RETENTION_DAYS,
    batchLimit: RETENTION_BATCH_LIMIT,
    timeBudgetMs: RETENTION_TIME_BUDGET_MS,
    maxIterations: RETENTION_MAX_ITERATIONS,
    onProgress: () => ctx.heartbeat(),
  });
}
