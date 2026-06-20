import {Context} from '@temporalio/activity';
import {config} from '#config.js';
import {type RetentionSweepResult, runRetentionSweep} from '#core/retention.js';
import {
  RETENTION_BATCH_LIMIT,
  RETENTION_MAX_ITERATIONS,
  RETENTION_TIME_BUDGET_MS,
} from '#temporal/constants.js';

/**
 * Cron-driven sweep that hard-deletes expired closed log streams (objects + rows). Heartbeats
 * once per stream so Temporal sees liveness well within the `heartbeatTimeout`; the core loop
 * self-bounds on `RETENTION_TIME_BUDGET_MS`, which is under the workflow's `startToCloseTimeout`
 * so a slow run stops before the next run starts (a `startToCloseTimeout` alone does not kill the
 * JS loop).
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
