import {createConfig, str} from '@shipfox/config';

export const config = createConfig({
  SHIPFOX_RUNNER_WORKSPACE_ROOT: str({
    desc: 'Parent directory for per-job workspaces. When unset, per-job directories are created under the OS temp directory. The runner only ever creates and cleans a per-job child directory under this root; it never touches the root itself. Rejected at startup if it resolves to an unsafe path (see resolveWorkspaceRoot in workspace.ts).',
    default: undefined,
  }),
});
