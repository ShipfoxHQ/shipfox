import type {SecretsInterModuleClient} from '@shipfox/api-secrets-dto/inter-module';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {logger} from '@shipfox/node-opentelemetry';
import {Context} from '@temporalio/activity';
import {config} from '#config.js';
import {type CronDrainSummary, drainDueCronSchedules} from '#core/drain-cron-schedules.js';

export async function drainCronBatchActivity(
  workflows: WorkflowsModuleClient,
  secrets: Pick<SecretsInterModuleClient, 'getSecret'>,
): Promise<CronDrainSummary> {
  const ctx = Context.current();
  return await drainDueCronSchedules({
    workflows,
    secrets,
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

// Upper bound on per-tick parallelism. A misconfigured TRIGGER_CRON_FANOUT (e.g. a
// pasted large number) is clamped to this rather than opening an unbounded number of
// transactions that could stall the tick, so one config mistake cannot stop cron firing.
const MAX_CRON_FANOUT = 32;

/**
 * Runs TRIGGER_CRON_FANOUT drains in parallel inside one activity. Temporal bills each
 * activity, and the tick fires every minute, so this is one action per tick instead of
 * one per drain plus the fanout read. Each drain runs in its own transaction, and `SKIP
 * LOCKED` keeps their claims disjoint. Every drain settles before the activity returns,
 * so a failed drain cannot leave another one running past the activity's end.
 */
export async function runCronTickActivity(
  workflows: WorkflowsModuleClient,
  secrets: Pick<SecretsInterModuleClient, 'getSecret'>,
): Promise<Omit<CronDrainSummary, 'claimed'>> {
  const fanout = Math.min(config.TRIGGER_CRON_FANOUT, MAX_CRON_FANOUT);
  if (fanout < config.TRIGGER_CRON_FANOUT) {
    logger().warn(
      {requested: config.TRIGGER_CRON_FANOUT, max: MAX_CRON_FANOUT},
      'Cron tick fanout exceeds the maximum; clamping',
    );
  }

  const results = await Promise.allSettled(
    Array.from({length: fanout}, () => drainCronBatchActivity(workflows, secrets)),
  );
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;

  const summaries = results.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
  return {
    fired: summaries.reduce((total, summary) => total + summary.fired, 0),
    errored: summaries.reduce((total, summary) => total + summary.errored, 0),
    retried: summaries.reduce((total, summary) => total + summary.retried, 0),
  };
}
