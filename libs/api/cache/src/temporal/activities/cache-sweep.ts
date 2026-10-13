import {Context} from '@temporalio/activity';
import type {WorkspaceStorageLimits} from '#core/storage-policy.js';
import {type CacheSweepResult, runCacheSweep} from '#core/sweep.js';
import {SWEEP_BATCH_LIMIT, SWEEP_TIME_BUDGET_MS} from '#temporal/constants.js';

/** Heartbeats per entry. The core loop owns the wall-clock budget. */
export function createCacheSweepActivity(deps: {limits: WorkspaceStorageLimits}) {
  return function cacheSweepActivity(): Promise<CacheSweepResult> {
    const ctx = Context.current();
    return runCacheSweep({
      limits: deps.limits,
      batchLimit: SWEEP_BATCH_LIMIT,
      timeBudgetMs: SWEEP_TIME_BUDGET_MS,
      onProgress: () => ctx.heartbeat(),
    });
  };
}
