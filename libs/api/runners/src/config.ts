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
