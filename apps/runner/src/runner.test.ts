vi.mock('#config.js', () => ({
  config: {
    SHIPFOX_API_URL: 'http://localhost',
    SHIPFOX_POLL_INTERVAL_MS: 5000,
    SHIPFOX_POLL_MAX_INTERVAL_MS: 30000,
    SHIPFOX_HEARTBEAT_INTERVAL_MS: 10_000,
    SHIPFOX_HEARTBEAT_MAX_STALE_MS: 10_000,
  },
}));

vi.mock('#heartbeat-loop.js', () => ({
  startHeartbeatLoop: vi.fn(() => ({stop: vi.fn()})),
}));

vi.mock('#workspace.js', async (importActual) => ({
  ...(await importActual<typeof import('#workspace.js')>()),
  jobWorkspacePath: vi.fn(),
  cleanupWorkspace: vi.fn(),
  resolveWorkspaceRoot: vi.fn(),
}));

vi.mock('#step-loop.js', () => ({
  runJobSteps: vi.fn(),
}));

vi.mock('#api-client.js', () => ({
  requestJob: vi.fn(),
  createLeaseClient: vi.fn(() => ({}) as never),
  HTTPError: class HTTPError extends Error {},
}));

import {createLeaseClient, requestJob} from '#api-client.js';
import {runJob, startRunner} from '#runner.js';
import {runJobSteps} from '#step-loop.js';
import {
  cleanupWorkspace,
  InvalidJobIdError,
  jobWorkspacePath,
  resolveWorkspaceRoot,
  UnsafeWorkspaceRootError,
} from '#workspace.js';

const mockJobWorkspacePath = vi.mocked(jobWorkspacePath);
const mockCleanupWorkspace = vi.mocked(cleanupWorkspace);
const mockResolveWorkspaceRoot = vi.mocked(resolveWorkspaceRoot);
const mockRunJobSteps = vi.mocked(runJobSteps);
const mockCreateLeaseClient = vi.mocked(createLeaseClient);
const mockRequestJob = vi.mocked(requestJob);

const JOB = {
  job_id: '00000000-0000-0000-0000-000000000001',
  run_id: '00000000-0000-0000-0000-000000000002',
  job_name: 'test-job',
  steps: [],
  lease_token: 'lease-token',
} as Parameters<typeof runJob>[0];

const WORKSPACE_ROOT = '/tmp/shipfox-test-root';
const JOB_CWD = '/tmp/shipfox-test-root/job-1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runJob', () => {
  it('runs the step loop with the per-job cwd and lease client, then cleans up', async () => {
    mockJobWorkspacePath.mockReturnValue(JOB_CWD);
    mockRunJobSteps.mockResolvedValue();

    await runJob(JOB, WORKSPACE_ROOT);

    expect(mockCreateLeaseClient).toHaveBeenCalledWith(JOB.lease_token);
    expect(mockRunJobSteps).toHaveBeenCalledWith(
      expect.objectContaining({jobId: JOB.job_id, cwd: JOB_CWD}),
    );
    expect(mockCleanupWorkspace).toHaveBeenCalledWith(JOB_CWD);
  });

  it('cleans up the per-job cwd when the step loop throws', async () => {
    mockJobWorkspacePath.mockReturnValue(JOB_CWD);
    mockRunJobSteps.mockRejectedValue(new Error('aborted'));

    await runJob(JOB, WORKSPACE_ROOT);

    expect(mockCleanupWorkspace).toHaveBeenCalledWith(JOB_CWD);
  });

  it('skips the job without running the loop or cleaning up when the job id is invalid', async () => {
    mockJobWorkspacePath.mockImplementation(() => {
      throw new InvalidJobIdError(JOB.job_id);
    });

    await runJob(JOB, WORKSPACE_ROOT);

    expect(mockRunJobSteps).not.toHaveBeenCalled();
    expect(mockCleanupWorkspace).not.toHaveBeenCalled();
  });
});

describe('startRunner', () => {
  it('exits before polling when the workspace root is unsafe', async () => {
    mockResolveWorkspaceRoot.mockImplementation(() => {
      throw new UnsafeWorkspaceRootError('/');
    });

    await expect(startRunner()).rejects.toThrow(UnsafeWorkspaceRootError);
    expect(mockRequestJob).not.toHaveBeenCalled();
  });
});
