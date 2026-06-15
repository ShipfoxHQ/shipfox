import {createConfig, num} from '@shipfox/config';

export const config = createConfig({
  SHIPFOX_POLL_INTERVAL_MS: num({
    desc: 'How often the runner asks the API for new jobs, in milliseconds. The runner backs off toward SHIPFOX_POLL_MAX_INTERVAL_MS while idle or after errors.',
    default: 5000,
  }),
  SHIPFOX_POLL_MAX_INTERVAL_MS: num({
    desc: 'Largest interval the poll backoff can reach, in milliseconds. This caps how long the runner waits between job checks.',
    default: 30000,
  }),
  SHIPFOX_HEARTBEAT_INTERVAL_MS: num({
    desc: "How often the runner sends a heartbeat, in milliseconds. Keep it well below the server's stuck-job threshold of 180 seconds.",
    default: 10_000,
  }),
  SHIPFOX_HEARTBEAT_MAX_STALE_MS: num({
    desc: 'How long a single heartbeat request may stay open, in milliseconds. After this time the runner cancels it and starts the next one. This limits overlapping requests when the API hangs.',
    default: 10_000,
  }),
});
