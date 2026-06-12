import {createConfig, num, str} from '@shipfox/config';

export const config = createConfig({
  SHIPFOX_API_URL: str({
    desc: 'Base URL of the Shipfox API the runner connects to, such as https://api.shipfox.io. Required.',
  }),
  SHIPFOX_POLL_INTERVAL_MS: num({
    desc: 'How often the runner asks the API for new jobs, in milliseconds. The runner backs off toward SHIPFOX_POLL_MAX_INTERVAL_MS while idle or after errors.',
    default: 5000,
  }),
  SHIPFOX_POLL_MAX_INTERVAL_MS: num({
    desc: 'Largest interval the poll backoff can reach, in milliseconds. This caps how long the runner waits between job checks.',
    default: 30000,
  }),
  SHIPFOX_RUNNER_TOKEN: str({
    desc: 'Bearer token the runner uses to authenticate with the API. Set a real value in production.',
    default: 'static-poc-token',
  }),
  SHIPFOX_RUNNER_WORKSPACE_ROOT: str({
    desc: 'Parent directory for per-job workspaces. When unset, per-job directories are created under the OS temp directory. The runner only ever creates and cleans a per-job child directory under this root; it never touches the root itself. Rejected at startup if it resolves to an unsafe path (see resolveWorkspaceRoot in workspace.ts).',
    default: undefined,
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
