import {createConfig, num} from '@shipfox/config';

export const config = createConfig({
  SHIPFOX_LOG_FLUSH_INTERVAL_MS: num({
    desc: 'How often the runner uploads buffered step logs, in milliseconds. This bounds how much recent output is lost if the runner machine dies mid-step.',
    default: 2000,
  }),
  SHIPFOX_LOG_FLUSH_BYTES: num({
    desc: 'Size threshold in bytes that triggers an early log upload before the interval elapses, so bursts of output do not wait for the timer.',
    default: 262144,
  }),
  SHIPFOX_LOG_SPOOL_MAX_BYTES: num({
    desc: 'Maximum number of not-yet-acknowledged log bytes the runner keeps on disk per step attempt. When the API is unreachable and this backlog is exceeded, further output is dropped and a gap marker is recorded instead of filling the disk.',
    default: 67108864,
  }),
  SHIPFOX_LOG_DRAIN_TIMEOUT_MS: num({
    desc: 'How long, in milliseconds, the runner waits at the end of a job for in-flight log uploads to finish before deleting the workspace. Bounds shutdown when the API is slow or unreachable.',
    default: 5000,
  }),
});
