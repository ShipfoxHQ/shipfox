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
