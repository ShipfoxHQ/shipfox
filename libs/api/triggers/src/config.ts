import {createConfig, num} from '@shipfox/config';

export const config = createConfig({
  TRIGGER_EVENT_RETENTION_DAYS: num({
    desc: 'How many days a recorded trigger event (and its decisions) is kept before the hourly prune cron deletes it. Must be at least 1; a smaller value moves the cutoff to now or the future and would delete freshly recorded events. Defaults to 30.',
    default: 30,
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
