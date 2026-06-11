import {createConfig, num, str} from '@shipfox/config';

export const config = createConfig({
  SHIPFOX_API_URL: str(),
  SHIPFOX_POLL_INTERVAL_MS: num({default: 5000}),
  SHIPFOX_POLL_MAX_INTERVAL_MS: num({default: 30000}),
  SHIPFOX_RUNNER_TOKEN: str({default: 'static-poc-token'}),
  SHIPFOX_RUNNER_WORKSPACE_ROOT: str({
    default: undefined,
    desc: 'Parent directory for per-job workspaces. When unset, per-job directories are created under the OS temp directory. The runner only ever creates and cleans a per-job child directory under this root; it never touches the root itself. Rejected at startup if it resolves to an unsafe path (see resolveWorkspaceRoot in workspace.ts).',
  }),
  // Heartbeat tick interval. Must be << stuck-job threshold (180s server-side).
  SHIPFOX_HEARTBEAT_INTERVAL_MS: num({default: 10_000}),
  // Max time a single in-flight heartbeat may stay outstanding before the loop
  // aborts it and schedules the next tick. Bounds overlap under a hung API.
  SHIPFOX_HEARTBEAT_MAX_STALE_MS: num({default: 10_000}),
});
