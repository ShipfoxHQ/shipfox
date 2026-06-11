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
  prepareWorkspace: vi.fn(),
  resolveWorkspaceRoot: vi.fn(),
}));

vi.mock('#executor.js', () => ({
  executeJob: vi.fn(),
}));

vi.mock('#api-client.js', () => ({
  completeJob: vi.fn(),
  requestJob: vi.fn(),
  HTTPError: class HTTPError extends Error {},
}));

import {completeJob, requestJob} from '#api-client.js';
import {executeJob} from '#executor.js';
import {runJob, startRunner} from '#runner.js';
import {prepareWorkspace, resolveWorkspaceRoot, UnsafeWorkspaceRootError} from '#workspace.js';

const mockPrepareWorkspace = vi.mocked(prepareWorkspace);
const mockResolveWorkspaceRoot = vi.mocked(resolveWorkspaceRoot);
const mockExecuteJob = vi.mocked(executeJob);
const mockCompleteJob = vi.mocked(completeJob);
const mockRequestJob = vi.mocked(requestJob);

const JOB = {
  job_id: '00000000-0000-0000-0000-000000000001',
  run_id: '00000000-0000-0000-0000-000000000002',
  job_name: 'test-job',
  steps: [],
} as Parameters<typeof runJob>[0];

const WORKSPACE_ROOT = '/tmp/shipfox-test-root';

function mockWorkspace() {
  const cleanup = vi.fn().mockResolvedValue(undefined);
  mockPrepareWorkspace.mockResolvedValue({cwd: '/tmp/shipfox-job-1', cleanup});
  return cleanup;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runJob', () => {
  beforeEach(() => {
    mockCompleteJob.mockResolvedValue({} as never);
  });

  it('cleans up and reports completion on success', async () => {
    const cleanup = mockWorkspace();
    mockExecuteJob.mockResolvedValue({status: 'succeeded', steps: []});

    await runJob(JOB, WORKSPACE_ROOT);

    expect(mockCompleteJob).toHaveBeenCalledWith(
      expect.objectContaining({jobId: JOB.job_id, status: 'succeeded'}),
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('reports completion before cleaning up (D2)', async () => {
    const cleanup = mockWorkspace();
    mockExecuteJob.mockResolvedValue({status: 'succeeded', steps: []});

    await runJob(JOB, WORKSPACE_ROOT);

    const completeOrder = mockCompleteJob.mock.invocationCallOrder[0] ?? 0;
    const cleanupOrder = cleanup.mock.invocationCallOrder[0] ?? 0;
    expect(completeOrder).toBeLessThan(cleanupOrder);
  });

  it('cleans up when a step fails', async () => {
    const cleanup = mockWorkspace();
    mockExecuteJob.mockResolvedValue({
      status: 'failed',
      steps: [{step_id: JOB.job_id, status: 'failed', error: {message: 'boom'}}],
    });

    await runJob(JOB, WORKSPACE_ROOT);

    expect(mockCompleteJob).toHaveBeenCalledWith(expect.objectContaining({status: 'failed'}));
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('cleans up when execution throws (e.g. cancellation)', async () => {
    const cleanup = mockWorkspace();
    mockExecuteJob.mockRejectedValue(new Error('aborted'));

    await runJob(JOB, WORKSPACE_ROOT);

    expect(mockCompleteJob).toHaveBeenCalledWith(
      expect.objectContaining({status: 'failed', steps: []}),
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('fails the job with empty steps and runs no steps when prepare fails', async () => {
    mockPrepareWorkspace.mockRejectedValue(new Error('mkdir failed'));

    await runJob(JOB, WORKSPACE_ROOT);

    expect(mockExecuteJob).not.toHaveBeenCalled();
    expect(mockCompleteJob).toHaveBeenCalledWith(
      expect.objectContaining({status: 'failed', steps: []}),
    );
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
