import {REGISTRATION_TOKEN_BATCH_HARD_MAX} from '@shipfox/api-runners-dto';
import {createConfig, num} from '@shipfox/config';

const EPHEMERAL_REGISTRATION_TOKEN_TTL_HARD_MAX_SECONDS = 3600;

export const config = createConfig({
  EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS: num({
    desc: `Lifetime of a provisioner-minted runner registration token, in seconds. The token can be exchanged once by a runner before this time passes. Set this between 1 and ${EPHEMERAL_REGISTRATION_TOKEN_TTL_HARD_MAX_SECONDS}.`,
    default: 300,
  }),
  REGISTRATION_TOKEN_BATCH_MAX: num({
    desc: `Maximum number of runner registration tokens a provisioner can mint in one batch request. Set this between 1 and ${REGISTRATION_TOKEN_BATCH_HARD_MAX}.`,
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
  RUNNER_ACTIVE_WINDOW_SECONDS: num({
    desc: 'Time window, in seconds, used to list active runners from recent heartbeats and provisioned runner reports.',
    default: 60,
  }),
  RUNNER_RECONCILE_TERMINATE_GRACE_SECONDS: num({
    desc: 'Grace window, in seconds, before reconcile marks an absent provisioned runner as terminated. Set this higher than the provisioner report interval so a transient empty or partial observed set does not kill a live runner.',
    default: 120,
  }),
  RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS: num({
    desc: 'Time, in seconds, after which a provisioned runner with no recent report, no live provisioner, no live runner session, and no running job is marked failed by backend maintenance.',
    default: 300,
  }),
  RUNNER_STALE_PROVISIONED_RUNNER_REAPER_LIMIT: num({
    desc: 'Maximum number of stale provisioned runners the maintenance worker marks failed in one run. Higher values clear backlogs faster but hold database locks longer.',
    default: 100,
  }),
  RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS: num({
    desc: 'Minimum time, in seconds, between runner session liveness writes from job request polls. Set this lower than RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS so active idle runners stay fresh.',
    default: 10,
  }),
  PROVISIONER_ACTIVE_WINDOW_SECONDS: num({
    desc: 'Time window, in seconds, used to list active provisioners from recent authenticated requests.',
    default: 120,
  }),
  PROVISIONER_LAST_SEEN_THROTTLE_SECONDS: num({
    desc: 'Minimum time, in seconds, between last-seen writes for one provisioner token.',
    default: 10,
  }),
});

if (
  !Number.isInteger(config.EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS) ||
  config.EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS < 1 ||
  config.EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS >
    EPHEMERAL_REGISTRATION_TOKEN_TTL_HARD_MAX_SECONDS
) {
  throw new Error(
    `EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS (${config.EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS}) must be a whole number of seconds between 1 and ${EPHEMERAL_REGISTRATION_TOKEN_TTL_HARD_MAX_SECONDS}.`,
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

if (
  !Number.isInteger(config.RUNNER_ACTIVE_WINDOW_SECONDS) ||
  config.RUNNER_ACTIVE_WINDOW_SECONDS < 1
) {
  throw new Error(
    `RUNNER_ACTIVE_WINDOW_SECONDS (${config.RUNNER_ACTIVE_WINDOW_SECONDS}) must be a whole number of seconds >= 1.`,
  );
}

if (
  !Number.isInteger(config.RUNNER_RECONCILE_TERMINATE_GRACE_SECONDS) ||
  config.RUNNER_RECONCILE_TERMINATE_GRACE_SECONDS < 1
) {
  throw new Error(
    `RUNNER_RECONCILE_TERMINATE_GRACE_SECONDS (${config.RUNNER_RECONCILE_TERMINATE_GRACE_SECONDS}) must be a whole number of seconds >= 1.`,
  );
}

if (
  !Number.isInteger(config.RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS) ||
  config.RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS < 1
) {
  throw new Error(
    `RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS (${config.RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS}) must be a whole number of seconds >= 1.`,
  );
}

if (
  !Number.isInteger(config.RUNNER_STALE_PROVISIONED_RUNNER_REAPER_LIMIT) ||
  config.RUNNER_STALE_PROVISIONED_RUNNER_REAPER_LIMIT < 1
) {
  throw new Error(
    `RUNNER_STALE_PROVISIONED_RUNNER_REAPER_LIMIT (${config.RUNNER_STALE_PROVISIONED_RUNNER_REAPER_LIMIT}) must be a whole number >= 1.`,
  );
}

if (
  !Number.isInteger(config.RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS) ||
  config.RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS < 1
) {
  throw new Error(
    `RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS (${config.RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS}) must be a whole number of seconds >= 1.`,
  );
}

if (
  !Number.isInteger(config.PROVISIONER_ACTIVE_WINDOW_SECONDS) ||
  config.PROVISIONER_ACTIVE_WINDOW_SECONDS < 1
) {
  throw new Error(
    `PROVISIONER_ACTIVE_WINDOW_SECONDS (${config.PROVISIONER_ACTIVE_WINDOW_SECONDS}) must be a whole number of seconds >= 1.`,
  );
}

if (
  !Number.isInteger(config.PROVISIONER_LAST_SEEN_THROTTLE_SECONDS) ||
  config.PROVISIONER_LAST_SEEN_THROTTLE_SECONDS < 1
) {
  throw new Error(
    `PROVISIONER_LAST_SEEN_THROTTLE_SECONDS (${config.PROVISIONER_LAST_SEEN_THROTTLE_SECONDS}) must be a whole number of seconds >= 1.`,
  );
}

if (
  config.RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS <=
  config.PROVISIONER_LAST_SEEN_THROTTLE_SECONDS
) {
  throw new Error(
    `RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS (${config.RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS}) must be greater than PROVISIONER_LAST_SEEN_THROTTLE_SECONDS (${config.PROVISIONER_LAST_SEEN_THROTTLE_SECONDS}).`,
  );
}

if (
  config.RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS <=
  config.RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS
) {
  throw new Error(
    `RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS (${config.RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS}) must be greater than RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS (${config.RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS}).`,
  );
}
