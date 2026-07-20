import {bool, createConfig, num} from '@shipfox/config';

export const config = createConfig({
  OUTBOX_DISPATCHER_ENABLED: bool({
    desc: 'Whether the API process drains pending outbox events. Use true to run the in-process dispatcher or false to disable automatic dispatch.',
    default: true,
  }),
  OUTBOX_DISPATCH_POLL_MS: num({
    desc: 'Time, in milliseconds, the in-process dispatcher waits before checking an empty outbox again.',
    default: 250,
  }),
});

if (!Number.isInteger(config.OUTBOX_DISPATCH_POLL_MS) || config.OUTBOX_DISPATCH_POLL_MS < 1) {
  throw new Error(
    `OUTBOX_DISPATCH_POLL_MS (${config.OUTBOX_DISPATCH_POLL_MS}) must be a whole number greater than 0.`,
  );
}
