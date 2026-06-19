vi.mock('#config.js', () => ({
  config: {
    SHIPFOX_POLL_INTERVAL_MS: 5000,
    SHIPFOX_POLL_MAX_INTERVAL_MS: 30000,
    SHIPFOX_HEARTBEAT_INTERVAL_MS: 10_000,
    SHIPFOX_HEARTBEAT_MAX_STALE_MS: 10_000,
  },
}));

vi.mock('@shipfox/runner-workspace', async (importActual) => ({
  ...(await importActual<typeof import('@shipfox/runner-workspace')>()),
  resolveWorkspaceRootFromEnv: vi.fn(),
}));

import type {RunnerProtocol} from '@shipfox/runner-protocol/contract';
import {resolveWorkspaceRootFromEnv, UnsafeWorkspaceRootError} from '@shipfox/runner-workspace';
import {startRunner} from '#core/runner.js';

const mockResolveWorkspaceRoot = vi.mocked(resolveWorkspaceRootFromEnv);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('startRunner', () => {
  it('exits before polling when the workspace root is unsafe', async () => {
    mockResolveWorkspaceRoot.mockImplementation(() => {
      throw new UnsafeWorkspaceRootError('/');
    });
    const requestJob = vi.fn();
    const protocol = {requestJob, heartbeat: vi.fn(), forJob: vi.fn()} as unknown as RunnerProtocol;

    await expect(startRunner({protocol})).rejects.toThrow(UnsafeWorkspaceRootError);
    expect(requestJob).not.toHaveBeenCalled();
  });
});
