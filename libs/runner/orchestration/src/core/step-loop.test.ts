import type {NextStepResponseDto, StepDto} from '@shipfox/api-workflows-dto';
import {HTTPError} from 'ky';

const requestNextStepMock = vi.fn();
const reportStepMock = vi.fn();
const executeRunStepMock = vi.fn();
const executeSetupStepMock = vi.fn();
const executeAgentStepMock = vi.fn();

vi.mock('@shipfox/runner-protocol', () => ({
  requestNextStep: (...args: unknown[]) => requestNextStepMock(...args),
  reportStep: (...args: unknown[]) => reportStepMock(...args),
  HTTPError,
}));

vi.mock('@shipfox/runner-execution', () => ({
  executeRunStep: (...args: unknown[]) => executeRunStepMock(...args),
  executeSetupStep: (...args: unknown[]) => executeSetupStepMock(...args),
  executeAgentStep: (...args: unknown[]) => executeAgentStepMock(...args),
}));

const {runJobSteps} = await import('#core/step-loop.js');

const JOB_ID = '00000000-0000-0000-0000-0000000000aa';
const leaseClient = {} as never;

describe('runJobSteps', () => {
  beforeEach(() => {
    requestNextStepMock.mockReset();
    reportStepMock.mockReset();
    executeRunStepMock.mockReset();
    executeSetupStepMock.mockReset();
    executeAgentStepMock.mockReset();
    reportStepMock.mockResolvedValue({ok: true, cancel: false});
    // Setup succeeds by default; tests that exercise setup failure override it.
    executeSetupStepMock.mockResolvedValue({success: true, output: '', error: null, exit_code: 0});
  });

  it('runs the setup step then a run step against the prepared cwd, reporting both', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    executeRunStepMock.mockResolvedValue({
      success: true,
      output: 'ok\n',
      error: null,
      exit_code: 0,
    });
    const ac = new AbortController();

    await runJobSteps({jobId: JOB_ID, leaseClient, signal: ac.signal, cwd: '/work'});

    expect(executeSetupStepMock).toHaveBeenCalledWith({cwd: '/work'});
    expect(executeRunStepMock).toHaveBeenCalledWith(run, {signal: ac.signal, cwd: '/work'});
    expect(reportStepMock).toHaveBeenCalledWith(leaseClient, {
      stepId: run.id,
      attempt: 1,
      status: 'succeeded',
      error: null,
      exitCode: 0,
      signal: ac.signal,
    });
    expect(requestNextStepMock).toHaveBeenCalledTimes(3);
  });

  it('reports the setup step failed with its reason, then stops on cancel:true (no user step runs)', async () => {
    const setup = buildSetupStep();
    const error = {message: 'mkdir denied', reason: 'workspace_prep_failed' as const};
    requestNextStepMock.mockResolvedValueOnce(stepResponse(setup, 1));
    executeSetupStepMock.mockResolvedValueOnce({
      success: false,
      output: '',
      error,
      exit_code: null,
    });
    reportStepMock.mockResolvedValueOnce({ok: true, cancel: true});
    const ac = new AbortController();

    await runJobSteps({jobId: JOB_ID, leaseClient, signal: ac.signal, cwd: '/work'});

    expect(reportStepMock).toHaveBeenCalledWith(leaseClient, {
      stepId: setup.id,
      attempt: 1,
      status: 'failed',
      error,
      exitCode: null,
      signal: ac.signal,
    });
    expect(executeRunStepMock).not.toHaveBeenCalled();
    expect(requestNextStepMock).toHaveBeenCalledTimes(1);
  });

  it('fails a run step dispatched before setup without spawning it', async () => {
    const run = buildRunStep();
    requestNextStepMock.mockResolvedValueOnce(stepResponse(run, 1));
    reportStepMock.mockResolvedValueOnce({ok: true, cancel: true});
    const ac = new AbortController();

    await runJobSteps({jobId: JOB_ID, leaseClient, signal: ac.signal, cwd: '/work'});

    expect(executeSetupStepMock).not.toHaveBeenCalled();
    expect(executeRunStepMock).not.toHaveBeenCalled();
    expect(reportStepMock).toHaveBeenCalledWith(leaseClient, {
      stepId: run.id,
      attempt: 1,
      status: 'failed',
      error: {message: 'Run step dispatched before setup prepared the workspace'},
      exitCode: null,
      signal: ac.signal,
    });
  });

  it('stops immediately when there are no steps', async () => {
    requestNextStepMock.mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    const ac = new AbortController();

    await runJobSteps({jobId: JOB_ID, leaseClient, signal: ac.signal, cwd: '/work'});

    expect(executeSetupStepMock).not.toHaveBeenCalled();
    expect(reportStepMock).not.toHaveBeenCalled();
  });

  it('stops without throwing on a 404 from next', async () => {
    requestNextStepMock.mockRejectedValueOnce(buildHTTPError(404));
    const ac = new AbortController();

    await expect(
      runJobSteps({jobId: JOB_ID, leaseClient, signal: ac.signal, cwd: '/work'}),
    ).resolves.toBeUndefined();

    expect(executeSetupStepMock).not.toHaveBeenCalled();
    expect(reportStepMock).not.toHaveBeenCalled();
  });

  it('rethrows non-404 errors from next (loop bails, no re-pull)', async () => {
    requestNextStepMock.mockRejectedValueOnce(buildHTTPError(500));
    const ac = new AbortController();

    await expect(
      runJobSteps({jobId: JOB_ID, leaseClient, signal: ac.signal, cwd: '/work'}),
    ).rejects.toThrow();

    expect(requestNextStepMock).toHaveBeenCalledTimes(1);
  });

  it('reports a failed run step with its exit_code after setup, then stops on cancel:true', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    const error = {message: 'Command exited with code 1', exit_code: 1};
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1));
    executeRunStepMock.mockResolvedValueOnce({
      success: false,
      output: 'boom\n',
      error,
      exit_code: 1,
    });
    reportStepMock
      .mockResolvedValueOnce({ok: true, cancel: false})
      .mockResolvedValueOnce({ok: true, cancel: true});
    const ac = new AbortController();

    await runJobSteps({jobId: JOB_ID, leaseClient, signal: ac.signal, cwd: '/work'});

    expect(reportStepMock).toHaveBeenCalledWith(leaseClient, {
      stepId: run.id,
      attempt: 1,
      status: 'failed',
      error,
      exitCode: 1,
      signal: ac.signal,
    });
    expect(requestNextStepMock).toHaveBeenCalledTimes(2);
  });

  it('reports the step failed when executeRunStep throws (no leaked error, no hung step)', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 2));
    executeRunStepMock.mockRejectedValueOnce(new Error('ENOSPC: no space left on device'));
    reportStepMock
      .mockResolvedValueOnce({ok: true, cancel: false})
      .mockResolvedValueOnce({ok: true, cancel: true});
    const ac = new AbortController();

    await expect(
      runJobSteps({jobId: JOB_ID, leaseClient, signal: ac.signal, cwd: '/work'}),
    ).resolves.toBeUndefined();

    expect(reportStepMock).toHaveBeenCalledWith(leaseClient, {
      stepId: run.id,
      attempt: 2,
      status: 'failed',
      error: {message: 'ENOSPC: no space left on device'},
      exitCode: null,
      signal: ac.signal,
    });
  });

  it('does not report when the signal aborts during setup', async () => {
    const setup = buildSetupStep();
    const ac = new AbortController();
    requestNextStepMock.mockResolvedValueOnce(stepResponse(setup, 1));
    executeSetupStepMock.mockImplementationOnce(() => {
      ac.abort();
      return Promise.resolve({success: true, output: '', error: null, exit_code: 0});
    });

    await runJobSteps({jobId: JOB_ID, leaseClient, signal: ac.signal, cwd: '/work'});

    expect(executeSetupStepMock).toHaveBeenCalledTimes(1);
    expect(reportStepMock).not.toHaveBeenCalled();
  });

  it('does nothing when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();

    await runJobSteps({jobId: JOB_ID, leaseClient, signal: ac.signal, cwd: '/work'});

    expect(requestNextStepMock).not.toHaveBeenCalled();
  });

  it('dispatches an agent step to executeAgentStep against the prepared cwd, reporting it', async () => {
    const setup = buildSetupStep();
    const agent = buildAgentStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(agent, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    executeAgentStepMock.mockResolvedValue({success: true, output: '', error: null, exit_code: 0});
    const ac = new AbortController();

    await runJobSteps({jobId: JOB_ID, leaseClient, signal: ac.signal, cwd: '/work'});

    expect(executeAgentStepMock).toHaveBeenCalledWith(agent, {signal: ac.signal, cwd: '/work'});
    expect(executeRunStepMock).not.toHaveBeenCalled();
    expect(reportStepMock).toHaveBeenCalledWith(leaseClient, {
      stepId: agent.id,
      attempt: 1,
      status: 'succeeded',
      error: null,
      exitCode: 0,
      signal: ac.signal,
    });
  });

  it('does not report the agent step when the signal aborts mid-run', async () => {
    const setup = buildSetupStep();
    const agent = buildAgentStep();
    const ac = new AbortController();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(agent, 1));
    executeAgentStepMock.mockImplementationOnce(() => {
      ac.abort();
      return Promise.resolve({
        success: false,
        output: '',
        error: {message: 'Agent step aborted', reason: 'agent_invocation_failed' as const},
        exit_code: null,
      });
    });

    await runJobSteps({jobId: JOB_ID, leaseClient, signal: ac.signal, cwd: '/work'});

    expect(executeAgentStepMock).toHaveBeenCalledTimes(1);
    // Only the setup step is reported; the aborted agent step is not.
    expect(reportStepMock).toHaveBeenCalledTimes(1);
    expect(reportStepMock).not.toHaveBeenCalledWith(
      leaseClient,
      expect.objectContaining({stepId: agent.id}),
    );
  });
});

function buildSetupStep(overrides: Partial<StepDto> = {}): StepDto {
  return buildStep({
    id: '00000000-0000-0000-0000-0000000000b0',
    name: 'Set up job',
    type: 'setup',
    config: {},
    position: 0,
    ...overrides,
  });
}

function buildRunStep(overrides: Partial<StepDto> = {}): StepDto {
  return buildStep({position: 1, ...overrides});
}

function buildAgentStep(overrides: Partial<StepDto> = {}): StepDto {
  return buildStep({
    id: '00000000-0000-0000-0000-0000000000c0',
    name: 'implement',
    type: 'agent',
    config: {model: 'claude-opus-4-8', thinking: 'high', prompt: 'Fix it.'},
    position: 1,
    ...overrides,
  });
}

function buildStep(overrides: Partial<StepDto> = {}): StepDto {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    job_id: JOB_ID,
    name: 'test-step',
    status: 'running',
    type: 'run',
    config: {run: 'echo test'},
    error: null,
    position: 0,
    current_attempt: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function stepResponse(step: StepDto, attempt: number): NextStepResponseDto {
  return {kind: 'step', step, attempt};
}

function buildHTTPError(status: number): HTTPError {
  const response = {status} as Response;
  const request = {} as Request;
  const options = {} as ConstructorParameters<typeof HTTPError>[2];
  return new HTTPError(response, request, options);
}
