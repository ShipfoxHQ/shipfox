import {createConfig, num} from '@shipfox/config';

export const config = createConfig({
  TRIGGER_EVENT_RETENTION_DAYS: num({
    desc: 'How many days a recorded trigger event (and its decisions) is kept before the hourly prune cron deletes it. Must be at least 1; a smaller value moves the cutoff to now or the future and would delete freshly recorded events. Defaults to 30.',
    default: 30,
  }),
  TRIGGER_CRON_JITTER_WINDOW_SECONDS: num({
    desc: 'Maximum number of seconds added as deterministic jitter to a cron trigger fire time. Use 0 to disable jitter. Values below about 60 seconds are usually no-ops when cron ticking runs at minute resolution; multi-minute windows spread large schedule herds.',
    default: 0,
  }),
  TRIGGER_CRON_FANOUT: num({
    desc: 'How many drain activities the once-per-minute cron tick runs in parallel. Each activity claims and fires one bounded batch, so the per-minute ceiling is TRIGGER_CRON_FANOUT times TRIGGER_CRON_CLAIM_BATCH runs. Raise it (and pod count) to fire more schedules per minute. Must be at least 1. Defaults to 2.',
    default: 2,
  }),
  TRIGGER_CRON_CLAIM_BATCH: num({
    desc: 'How many due cron schedules a single drain activity claims and fires per tick. Bounds the load a cron burst can put on the database and the run-creation path. Must be at least 1. Defaults to 100.',
    default: 100,
  }),
});

export function assertRetentionDaysWithinBounds(days: number): void {
  if (!Number.isFinite(days) || days < 1) {
    throw new Error(
      `TRIGGER_EVENT_RETENTION_DAYS must be a finite number of at least 1, received ${days}.`,
    );
  }
}

assertRetentionDaysWithinBounds(config.TRIGGER_EVENT_RETENTION_DAYS);

export function assertCronConfigWithinBounds(jitterWindowSeconds: number): void {
  if (!Number.isFinite(jitterWindowSeconds) || jitterWindowSeconds < 0) {
    throw new Error(
      `TRIGGER_CRON_JITTER_WINDOW_SECONDS must be a finite non-negative number, received ${jitterWindowSeconds}.`,
    );
  }
}

assertCronConfigWithinBounds(config.TRIGGER_CRON_JITTER_WINDOW_SECONDS);

export function assertCronThroughputWithinBounds(fanout: number, claimBatch: number): void {
  if (!Number.isInteger(fanout) || fanout < 1) {
    throw new Error(`TRIGGER_CRON_FANOUT must be an integer of at least 1, received ${fanout}.`);
  }
  if (!Number.isInteger(claimBatch) || claimBatch < 1) {
    throw new Error(
      `TRIGGER_CRON_CLAIM_BATCH must be an integer of at least 1, received ${claimBatch}.`,
    );
  }
}

assertCronThroughputWithinBounds(config.TRIGGER_CRON_FANOUT, config.TRIGGER_CRON_CLAIM_BATCH);
