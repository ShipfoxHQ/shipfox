import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {Context} from '@temporalio/activity';
import {config} from '#config.js';
import {type CronDrainSummary, drainDueCronSchedules} from '#core/drain-cron-schedules.js';

export async function drainCronBatchActivity(
  workflows: WorkflowsModuleClient,
): Promise<CronDrainSummary> {
  const ctx = Context.current();
  return await drainDueCronSchedules({
    workflows,
    batchSize: config.TRIGGER_CRON_CLAIM_BATCH,
    jitterWindowSeconds: config.TRIGGER_CRON_JITTER_WINDOW_SECONDS,
    onScheduleProcessed: () => ctx.heartbeat(),
  });
}

// Read at runtime rather than baked into the cron workflow's start args: a start arg
// would freeze fanout at first launch (a restart re-skips the already-running workflow),
// so an activity read lets a config change take effect on the next tick after a worker
// restart, consistent with how TRIGGER_CRON_CLAIM_BATCH is read in the drain activity.
export function readCronFanoutActivity(): Promise<number> {
  return Promise.resolve(config.TRIGGER_CRON_FANOUT);
}
