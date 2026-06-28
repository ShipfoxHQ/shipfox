import {REGISTRATION_TOKEN_BATCH_HARD_MAX} from '@shipfox/api-runners-dto';
import {createConfig, num} from '@shipfox/config';

export const config = createConfig({
  EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS: num({
    desc: 'Lifetime of a provisioner-minted runner registration token, in seconds. The token can be exchanged once by a runner before this time passes.',
    default: 300,
  }),
  REGISTRATION_TOKEN_BATCH_MAX: num({
    desc: 'Maximum number of runner registration tokens a provisioner can mint in one batch request. Set this between 1 and 1000.',
    default: 500,
  }),
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

if (
  !Number.isInteger(config.EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS) ||
  config.EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS < 1
) {
  throw new Error(
    `EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS (${config.EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS}) must be a whole number of seconds >= 1.`,
  );
}

if (
  !Number.isInteger(config.REGISTRATION_TOKEN_BATCH_MAX) ||
  config.REGISTRATION_TOKEN_BATCH_MAX < 1 ||
  config.REGISTRATION_TOKEN_BATCH_MAX > REGISTRATION_TOKEN_BATCH_HARD_MAX
) {
  throw new Error(
    `REGISTRATION_TOKEN_BATCH_MAX (${config.REGISTRATION_TOKEN_BATCH_MAX}) must be a whole number between 1 and ${REGISTRATION_TOKEN_BATCH_HARD_MAX}.`,
  );
}

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
