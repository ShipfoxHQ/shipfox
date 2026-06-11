import type {NextStepResponseDto, StepDto} from '@shipfox/api-workflows-dto';
import {HTTPError} from 'ky';

const requestNextStepMock = vi.fn();
const reportStepMock = vi.fn();
const executeRunStepMock = vi.fn();

vi.mock('#api-client.js', () => ({
  requestNextStep: (...args: unknown[]) => requestNextStepMock(...args),
  reportStep: (...args: unknown[]) => reportStepMock(...args),
  HTTPError,
}));

vi.mock('#run-step.js', () => ({
  executeRunStep: (...args: unknown[]) => executeRunStepMock(...args),
}));

const {runJobSteps} = await import('#step-loop.js');

const JOB_ID = '00000000-0000-0000-0000-0000000000aa';
const leaseClient = {} as never;

describe('runJobSteps', () => {
  beforeEach(() => {
    requestNextStepMock.mockReset();
    reportStepMock.mockReset();
    executeRunStepMock.mockReset();
    reportStepMock.mockResolvedValue({ok: true, cancel: false});
  });

  it('pulls, executes, reports (echoing attempt + exit_code), then stops on done', async () => {
    const step = buildStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(step, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    executeRunStepMock.mockResolvedValue({
      success: true,
      output: 'ok\n',
      error: null,
      exit_code: 0,
    });
    const ac = new AbortController();

    await runJobSteps({jobId: JOB_ID, leaseClient, signal: ac.signal, cwd: '/work'});

    expect(executeRunStepMock).toHaveBeenCalledTimes(1);
    expect(reportStepMock).toHaveBeenCalledWith(leaseClient, {
      stepId: step.id,
      attempt: 1,
      status: 'succeeded',
      error: null,
      exitCode: 0,
      signal: ac.signal,
    });
    expect(requestNextStepMock).toHaveBeenCalledTimes(2);
  });

  it('stops immediately when there are no steps', async () => {
    requestNextStepMock.mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    const ac = new AbortController();

    await runJobSteps({jobId: JOB_ID, leaseClient, signal: ac.signal, cwd: '/work'});

    expect(executeRunStepMock).not.toHaveBeenCalled();
    expect(reportStepMock).not.toHaveBeenCalled();
  });

  it('stops without throwing on a 404 from next', async () => {
    requestNextStepMock.mockRejectedValueOnce(buildHTTPError(404));
    const ac = new AbortController();

    await expect(
      runJobSteps({jobId: JOB_ID, leaseClient, signal: ac.signal, cwd: '/work'}),
    ).resolves.toBeUndefined();

    expect(executeRunStepMock).not.toHaveBeenCalled();
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

  it('reports a failed step with its exit_code, then stops on cancel:true', async () => {
    const step = buildStep();
    const error = {message: 'Command exited with code 1', exit_code: 1};
    requestNextStepMock.mockResolvedValueOnce(stepResponse(step, 1));
    executeRunStepMock.mockResolvedValueOnce({
      success: false,
      output: 'boom\n',
      error,
      exit_code: 1,
    });
    reportStepMock.mockResolvedValueOnce({ok: true, cancel: true});
    const ac = new AbortController();

    await runJobSteps({jobId: JOB_ID, leaseClient, signal: ac.signal, cwd: '/work'});

    expect(reportStepMock).toHaveBeenCalledWith(leaseClient, {
      stepId: step.id,
      attempt: 1,
      status: 'failed',
      error,
      exitCode: 1,
      signal: ac.signal,
    });
    expect(requestNextStepMock).toHaveBeenCalledTimes(1);
  });

  it('reports the step failed when executeRunStep throws (no leaked error, no hung step)', async () => {
    const step = buildStep();
    requestNextStepMock.mockResolvedValueOnce(stepResponse(step, 2));
    executeRunStepMock.mockRejectedValueOnce(new Error('ENOSPC: no space left on device'));
    reportStepMock.mockResolvedValueOnce({ok: true, cancel: true});
    const ac = new AbortController();

    await expect(
      runJobSteps({jobId: JOB_ID, leaseClient, signal: ac.signal, cwd: '/work'}),
    ).resolves.toBeUndefined();

    expect(reportStepMock).toHaveBeenCalledWith(leaseClient, {
      stepId: step.id,
      attempt: 2,
      status: 'failed',
      error: {message: 'ENOSPC: no space left on device'},
      exitCode: null,
      signal: ac.signal,
    });
  });

  it('does not report when the signal aborts mid-step', async () => {
    const step = buildStep();
    const ac = new AbortController();
    requestNextStepMock.mockResolvedValueOnce(stepResponse(step, 1));
    executeRunStepMock.mockImplementationOnce(() => {
      ac.abort();
      return Promise.resolve({success: true, output: '', error: null, exit_code: 0});
    });

    await runJobSteps({jobId: JOB_ID, leaseClient, signal: ac.signal, cwd: '/work'});

    expect(executeRunStepMock).toHaveBeenCalledTimes(1);
    expect(reportStepMock).not.toHaveBeenCalled();
  });

  it('does nothing when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();

    await runJobSteps({jobId: JOB_ID, leaseClient, signal: ac.signal, cwd: '/work'});

    expect(requestNextStepMock).not.toHaveBeenCalled();
  });
});

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
