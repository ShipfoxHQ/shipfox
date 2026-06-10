import type {NextStepResponseDto, StepDto} from '@shipfox/api-workflows-dto';

vi.mock('#api-client.js', () => ({nextStep: vi.fn(), reportStep: vi.fn()}));
vi.mock('#run-step.js', () => ({executeRunStep: vi.fn()}));

import {nextStep, reportStep} from '#api-client.js';
import {executeJob} from '#executor.js';
import {executeRunStep} from '#run-step.js';

const mockNextStep = vi.mocked(nextStep);
const mockReportStep = vi.mocked(reportStep);
const mockExecuteRunStep = vi.mocked(executeRunStep);

const LEASE = 'lease-token';

function stepDto(id: string, position: number): StepDto {
  return {
    id,
    job_id: '00000000-0000-0000-0000-0000000000aa',
    name: `step-${position}`,
    status: 'running',
    type: 'run',
    config: {run: 'echo test'},
    error: null,
    position,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function stepResponse(id: string, position: number, attempt = 1): NextStepResponseDto {
  return {kind: 'step', step: stepDto(id, position), attempt};
}

describe('executeJob', () => {
  beforeEach(() => {
    mockNextStep.mockReset();
    mockReportStep.mockReset();
    mockExecuteRunStep.mockReset();
    mockReportStep.mockResolvedValue({ok: true, cancel: false});
  });

  it('pulls, runs, and reports each step until the job is done', async () => {
    mockNextStep
      .mockResolvedValueOnce(stepResponse('s0', 0))
      .mockResolvedValueOnce(stepResponse('s1', 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    mockExecuteRunStep.mockResolvedValue({success: true, output: '', exit_code: 0, error: null});

    const result = await executeJob({leaseToken: LEASE});

    expect(result).toEqual({status: 'succeeded'});
    expect(mockExecuteRunStep).toHaveBeenCalledTimes(2);
    expect(mockReportStep).toHaveBeenNthCalledWith(1, LEASE, 's0', {
      status: 'succeeded',
      attempt: 1,
      exit_code: 0,
    });
    expect(mockReportStep).toHaveBeenNthCalledWith(2, LEASE, 's1', {
      status: 'succeeded',
      attempt: 1,
      exit_code: 0,
    });
  });

  it('returns the done status immediately when there is nothing to run', async () => {
    mockNextStep.mockResolvedValueOnce({kind: 'done', status: 'succeeded'});

    const result = await executeJob({leaseToken: LEASE});

    expect(result).toEqual({status: 'succeeded'});
    expect(mockExecuteRunStep).not.toHaveBeenCalled();
  });

  it('reports a failed step with its exit_code and error, then stops on cancel', async () => {
    mockNextStep.mockResolvedValueOnce(stepResponse('s0', 0));
    mockExecuteRunStep.mockResolvedValue({
      success: false,
      output: '',
      exit_code: 1,
      error: {message: 'Command exited with code 1', exit_code: 1},
    });
    mockReportStep.mockResolvedValue({ok: true, cancel: true});

    const result = await executeJob({leaseToken: LEASE});

    expect(result).toEqual({status: 'failed'});
    expect(mockReportStep).toHaveBeenCalledWith(LEASE, 's0', {
      status: 'failed',
      attempt: 1,
      exit_code: 1,
      error: {message: 'Command exited with code 1', exit_code: 1},
    });
    // The host said the job is over; the runner must not pull again.
    expect(mockNextStep).toHaveBeenCalledTimes(1);
  });

  it('echoes the dispatched attempt number on the report', async () => {
    mockNextStep
      .mockResolvedValueOnce(stepResponse('s0', 0, 2))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    mockExecuteRunStep.mockResolvedValue({success: true, output: '', exit_code: 0, error: null});

    await executeJob({leaseToken: LEASE});

    expect(mockReportStep).toHaveBeenCalledWith(LEASE, 's0', {
      status: 'succeeded',
      attempt: 2,
      exit_code: 0,
    });
  });
});
