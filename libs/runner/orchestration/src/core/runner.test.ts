vi.mock('#config.js', () => ({
  config: {
    SHIPFOX_POLL_INTERVAL_MS: 1,
    SHIPFOX_POLL_MAX_INTERVAL_MS: 5,
    SHIPFOX_POLL_MAX_DURATION_MS: 1,
    SHIPFOX_HEARTBEAT_INTERVAL_MS: 10_000,
    SHIPFOX_HEARTBEAT_MAX_STALE_MS: 10_000,
  },
}));

vi.mock('#core/heartbeat-loop.js', () => ({
  startHeartbeatLoop: vi.fn(() => ({stop: vi.fn()})),
}));

vi.mock('@shipfox/runner-workspace', async (importActual) => ({
  ...(await importActual<typeof import('@shipfox/runner-workspace')>()),
  cleanupJobLogs: vi.fn(),
  jobWorkspacePath: vi.fn(),
  jobLogsPath: vi.fn(),
  cleanupWorkspace: vi.fn(),
  resolveWorkspaceRootFromEnv: vi.fn(),
}));

vi.mock('#core/step-loop.js', () => ({
  runJobSteps: vi.fn(),
}));

vi.mock('@shipfox/runner-protocol', () => ({
  registerRunnerSession: vi.fn(),
  requireRunnerLabels: vi.fn(),
  requestJob: vi.fn(),
  createLeaseClient: vi.fn(() => ({}) as never),
  runnerToken: vi.fn(() => 'runner-token'),
  RunnerLabelsRequiredError: class RunnerLabelsRequiredError extends Error {},
  RunnerSessionExhaustedError: class RunnerSessionExhaustedError extends Error {},
  HTTPError: class HTTPError extends Error {
    response: {status: number};

    constructor(status = 500) {
      super(`HTTP ${status}`);
      this.response = {status};
    }
  },
}));

import {
  createLeaseClient,
  HTTPError,
  RunnerLabelsRequiredError,
  RunnerSessionExhaustedError,
  registerRunnerSession,
  requestJob,
  requireRunnerLabels,
} from '@shipfox/runner-protocol';
import {
  cleanupJobLogs,
  cleanupWorkspace,
  InvalidJobIdError,
  jobLogsPath,
  jobWorkspacePath,
  resolveWorkspaceRootFromEnv,
  UnsafeWorkspaceRootError,
} from '@shipfox/runner-workspace';
import {config as runnerConfig} from '#config.js';
import {startHeartbeatLoop} from '#core/heartbeat-loop.js';
import {
  nextBackoffInterval,
  nextPollDeadline,
  runJob,
  startRunner,
  withJitter,
} from '#core/runner.js';
import {runJobSteps} from '#core/step-loop.js';

const mockJobWorkspacePath = vi.mocked(jobWorkspacePath);
const mockJobLogsPath = vi.mocked(jobLogsPath);
const mockCleanupWorkspace = vi.mocked(cleanupWorkspace);
const mockCleanupJobLogs = vi.mocked(cleanupJobLogs);
const mockResolveWorkspaceRoot = vi.mocked(resolveWorkspaceRootFromEnv);
const mockRunJobSteps = vi.mocked(runJobSteps);
const mockCreateLeaseClient = vi.mocked(createLeaseClient);
const mockRegisterRunnerSession = vi.mocked(registerRunnerSession);
const mockRequireRunnerLabels = vi.mocked(requireRunnerLabels);
const mockRequestJob = vi.mocked(requestJob);
const mockStartHeartbeatLoop = vi.mocked(startHeartbeatLoop);

const JOB = {
  job_id: '00000000-0000-0000-0000-000000000001',
  run_id: '00000000-0000-0000-0000-000000000002',
  job_name: 'test-job',
  steps: [],
  lease_token: 'lease-token',
} as Parameters<typeof runJob>[0];

const WORKSPACE_ROOT = '/tmp/shipfox-test-root';
const JOB_CWD = '/tmp/shipfox-test-root/job-1';
const JOB_LOGS_DIR = '/tmp/shipfox-test-root/.shipfox-runner-logs/job-1';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  setPollConfig({interval: 1, maxInterval: 5, maxDuration: 1});
  mockResolveWorkspaceRoot.mockReturnValue(WORKSPACE_ROOT);
  mockRequireRunnerLabels.mockReturnValue(['local']);
  mockRegisterRunnerSession.mockResolvedValue({
    session_id: '00000000-0000-0000-0000-000000000003',
    session_token: 'session-token',
    mode: 'manual',
    max_claims: null,
  });
  mockJobWorkspacePath.mockReturnValue(JOB_CWD);
  mockJobLogsPath.mockReturnValue(JOB_LOGS_DIR);
  mockRunJobSteps.mockResolvedValue();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runJob', () => {
  it('runs the step loop with the per-job cwd and lease client, then cleans up', async () => {
    mockJobWorkspacePath.mockReturnValue(JOB_CWD);
    mockJobLogsPath.mockReturnValue(JOB_LOGS_DIR);
    mockRunJobSteps.mockResolvedValue();

    await runJob(JOB, WORKSPACE_ROOT);

    expect(mockStartHeartbeatLoop).toHaveBeenCalledWith(
      JOB.job_id,
      JOB.lease_token,
      expect.any(AbortController),
      expect.objectContaining({
        intervalMs: 10_000,
        maxStaleMs: 10_000,
      }),
    );
    expect(mockCreateLeaseClient).toHaveBeenCalledWith(JOB.lease_token);
    expect(mockRunJobSteps).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: JOB.job_id,
        cwd: JOB_CWD,
        logsDir: JOB_LOGS_DIR,
        jobContext: {jobId: JOB.job_id, runId: JOB.run_id},
      }),
    );
    expect(mockCleanupWorkspace).toHaveBeenCalledWith(JOB_CWD);
    expect(mockCleanupJobLogs).toHaveBeenCalledWith(JOB_LOGS_DIR);
  });

  it('cleans up the per-job cwd when the step loop throws', async () => {
    mockJobWorkspacePath.mockReturnValue(JOB_CWD);
    mockJobLogsPath.mockReturnValue(JOB_LOGS_DIR);
    mockRunJobSteps.mockRejectedValue(new Error('aborted'));

    await runJob(JOB, WORKSPACE_ROOT);

    expect(mockCleanupWorkspace).toHaveBeenCalledWith(JOB_CWD);
    expect(mockCleanupJobLogs).toHaveBeenCalledWith(JOB_LOGS_DIR);
  });

  it('skips the job without running the loop or cleaning up when the job id is invalid', async () => {
    mockJobWorkspacePath.mockImplementation(() => {
      throw new InvalidJobIdError(JOB.job_id);
    });

    await runJob(JOB, WORKSPACE_ROOT);

    expect(mockRunJobSteps).not.toHaveBeenCalled();
    expect(mockCleanupWorkspace).not.toHaveBeenCalled();
    expect(mockCleanupJobLogs).not.toHaveBeenCalled();
  });
});

describe('startRunner', () => {
  it('exits before polling when the workspace root is unsafe', async () => {
    mockResolveWorkspaceRoot.mockImplementation(() => {
      throw new UnsafeWorkspaceRootError('/');
    });

    await expect(startRunner()).rejects.toThrow(UnsafeWorkspaceRootError);
    expect(mockRegisterRunnerSession).not.toHaveBeenCalled();
    expect(mockRequestJob).not.toHaveBeenCalled();
  });

  it('exits before polling when runner labels are empty', async () => {
    mockRequireRunnerLabels.mockImplementation(() => {
      throw new RunnerLabelsRequiredError();
    });

    await expect(startRunner()).rejects.toThrow(RunnerLabelsRequiredError);
    expect(mockRegisterRunnerSession).not.toHaveBeenCalled();
    expect(mockRequestJob).not.toHaveBeenCalled();
  });

  it('resolves cleanly when no jobs arrive before the poll deadline', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(2);
    mockRequestJob.mockResolvedValue(null);

    await startRunner();

    expect(mockRegisterRunnerSession).toHaveBeenCalledTimes(1);
    expect(mockRequestJob).toHaveBeenCalledTimes(1);
    expect(mockRunJobSteps).not.toHaveBeenCalled();
  });

  it('rejects when poll errors continue past the poll deadline', async () => {
    const pollError = new Error('api unavailable');
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(2);
    mockRequestJob.mockRejectedValue(pollError);

    await expect(startRunner()).rejects.toBe(pollError);
    expect(mockRegisterRunnerSession).toHaveBeenCalledTimes(1);
    expect(mockRequestJob).toHaveBeenCalledTimes(1);
  });

  it('resolves cleanly when the runner session is exhausted', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    mockRequestJob.mockRejectedValue(new RunnerSessionExhaustedError());

    await startRunner();

    expect(mockRegisterRunnerSession).toHaveBeenCalledTimes(1);
    expect(mockRequestJob).toHaveBeenCalledTimes(1);
  });

  it('registers a new session when the current session is unauthorized', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    mockRequestJob
      .mockRejectedValueOnce(httpError(401))
      .mockRejectedValueOnce(new RunnerSessionExhaustedError());

    await startRunner();

    expect(mockRegisterRunnerSession).toHaveBeenCalledTimes(2);
    expect(mockRequestJob).toHaveBeenCalledTimes(2);
  });

  it('rejects when unauthorized responses continue past the poll deadline', async () => {
    const unauthorized = httpError(401);
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(2);
    mockRequestJob.mockRejectedValue(unauthorized);

    await expect(startRunner()).rejects.toBe(unauthorized);
    expect(mockRegisterRunnerSession).toHaveBeenCalledTimes(2);
    expect(mockRequestJob).toHaveBeenCalledTimes(2);
  });

  it('resets the poll deadline after completing a job', async () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(3)
      .mockReturnValue(3);
    mockRequestJob
      .mockResolvedValueOnce(JOB)
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new RunnerSessionExhaustedError());

    await startRunner();

    expect(mockRunJobSteps).toHaveBeenCalledTimes(1);
    expect(mockRequestJob).toHaveBeenCalledTimes(3);
  });

  it('does not register duplicate signal handlers across repeated starts', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    mockRequestJob.mockRejectedValue(new RunnerSessionExhaustedError());
    const sigintListeners = process.listenerCount('SIGINT');
    const sigtermListeners = process.listenerCount('SIGTERM');

    await startRunner();
    await startRunner();

    expect(process.listenerCount('SIGINT')).toBeLessThanOrEqual(sigintListeners + 1);
    expect(process.listenerCount('SIGTERM')).toBeLessThanOrEqual(sigtermListeners + 1);
  });
});

describe('poll helpers', () => {
  it('grows backoff intervals before reaching the configured cap', () => {
    const next = nextBackoffInterval(2);

    expect(next).toBe(3);
  });

  it('grows backoff intervals up to the configured cap', () => {
    const next = nextBackoffInterval(4);

    expect(next).toBe(5);
  });

  it.each([
    {random: 0, expected: 0},
    {random: 0.25, expected: 2},
    {random: 0.999, expected: 7.992},
  ])('applies full jitter at random=$random', ({random, expected}) => {
    vi.spyOn(Math, 'random').mockReturnValue(random);

    const sleep = withJitter(8);

    expect(sleep).toBe(expected);
  });

  it('keeps zero sleeps at zero when jittered', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);

    const sleep = withJitter(0);

    expect(sleep).toBe(0);
  });

  it('computes a poll deadline from the configured max duration', () => {
    vi.spyOn(Date, 'now').mockReturnValue(41);

    const deadline = nextPollDeadline();

    expect(deadline).toBe(42);
  });

  it('disables the poll deadline when max duration is zero', () => {
    setPollConfig({maxDuration: 0});

    const deadline = nextPollDeadline();

    expect(deadline).toBeUndefined();
  });
});

function httpError(status: number): InstanceType<typeof HTTPError> {
  const error = Object.create(HTTPError.prototype) as InstanceType<typeof HTTPError>;
  Object.assign(error, {response: new Response(null, {status})});
  return error;
}

function setPollConfig(values: {
  interval?: number;
  maxInterval?: number;
  maxDuration?: number;
}): void {
  const mutableConfig = runnerConfig as {
    SHIPFOX_POLL_INTERVAL_MS: number;
    SHIPFOX_POLL_MAX_INTERVAL_MS: number;
    SHIPFOX_POLL_MAX_DURATION_MS: number;
  };

  if (values.interval !== undefined) mutableConfig.SHIPFOX_POLL_INTERVAL_MS = values.interval;
  if (values.maxInterval !== undefined)
    mutableConfig.SHIPFOX_POLL_MAX_INTERVAL_MS = values.maxInterval;
  if (values.maxDuration !== undefined)
    mutableConfig.SHIPFOX_POLL_MAX_DURATION_MS = values.maxDuration;
}
