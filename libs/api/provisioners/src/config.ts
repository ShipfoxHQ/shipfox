import {createConfig, num} from '@shipfox/config';

export const config = createConfig({
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
