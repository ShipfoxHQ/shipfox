import {createConfig, num} from '@shipfox/config';

export const config = createConfig({
  RESERVATION_TTL_SECONDS: num({
    desc: 'Lifetime of a count-based runner reservation, in seconds. Expired reservations stop counting against queued demand.',
    default: 60,
  }),
  RESERVATION_LONG_POLL_MAX_WAIT_SECONDS: num({
    desc: 'Maximum time the provisioner demand poll endpoint waits for reservable demand before returning, in seconds.',
    default: 30,
  }),
  RESERVATION_POLL_INTERVAL_MS: num({
    desc: 'Initial interval between demand re-checks while a provisioner request is waiting, in milliseconds.',
    default: 1000,
  }),
  RESERVATION_POLL_MAX_INTERVAL_MS: num({
    desc: 'Maximum backoff interval between demand re-checks while a provisioner request is waiting, in milliseconds.',
    default: 5000,
  }),
});

if (!Number.isInteger(config.RESERVATION_TTL_SECONDS) || config.RESERVATION_TTL_SECONDS < 1) {
  throw new Error(
    `RESERVATION_TTL_SECONDS (${config.RESERVATION_TTL_SECONDS}) must be a whole number of seconds >= 1.`,
  );
}

if (
  !Number.isInteger(config.RESERVATION_LONG_POLL_MAX_WAIT_SECONDS) ||
  config.RESERVATION_LONG_POLL_MAX_WAIT_SECONDS < 0
) {
  throw new Error(
    `RESERVATION_LONG_POLL_MAX_WAIT_SECONDS (${config.RESERVATION_LONG_POLL_MAX_WAIT_SECONDS}) must be a whole number of seconds >= 0.`,
  );
}

if (
  !Number.isInteger(config.RESERVATION_POLL_INTERVAL_MS) ||
  config.RESERVATION_POLL_INTERVAL_MS < 1
) {
  throw new Error(
    `RESERVATION_POLL_INTERVAL_MS (${config.RESERVATION_POLL_INTERVAL_MS}) must be a whole number of milliseconds >= 1.`,
  );
}

if (
  !Number.isInteger(config.RESERVATION_POLL_MAX_INTERVAL_MS) ||
  config.RESERVATION_POLL_MAX_INTERVAL_MS < config.RESERVATION_POLL_INTERVAL_MS
) {
  throw new Error(
    `RESERVATION_POLL_MAX_INTERVAL_MS (${config.RESERVATION_POLL_MAX_INTERVAL_MS}) must be a whole number of milliseconds >= RESERVATION_POLL_INTERVAL_MS (${config.RESERVATION_POLL_INTERVAL_MS}).`,
  );
}
