import type {JobPayloadDto} from '@shipfox/api-runners-dto';

vi.mock('#run-step.js', () => ({
  executeRunStep: vi.fn(),
}));

import {executeJob} from '#executor.js';
import {executeRunStep} from '#run-step.js';

const mockExecuteRunStep = vi.mocked(executeRunStep);

describe('executeJob', () => {
  beforeEach(() => {
    mockExecuteRunStep.mockReset();
  });

  it('executes steps in position order', async () => {
    const callOrder: number[] = [];
    mockExecuteRunStep.mockImplementation((step) => {
      callOrder.push(step.position);
      return Promise.resolve({success: true, output: '', error: null});
    });

    const job = buildJob([
      {position: 2, name: 'second'},
      {position: 0, name: 'first'},
      {position: 1, name: 'middle'},
    ]);

    await executeJob(job);

    expect(callOrder).toEqual([0, 1, 2]);
  });

  it('returns succeeded with one entry per step when all pass', async () => {
    mockExecuteRunStep.mockResolvedValue({success: true, output: 'ok\n', error: null});

    const job = buildJob([{position: 0}, {position: 1}]);

    const result = await executeJob(job);

    expect(result.status).toBe('succeeded');
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]).toEqual({step_id: job.steps[0]?.id, status: 'succeeded', error: null});
    expect(result.steps[1]).toEqual({step_id: job.steps[1]?.id, status: 'succeeded', error: null});
  });

  it('stops on first failure and only reports up to the failed step', async () => {
    mockExecuteRunStep
      .mockResolvedValueOnce({success: true, output: 'step1\n', error: null})
      .mockResolvedValueOnce({
        success: false,
        output: 'step2-err\n',
        error: {message: 'Command exited with code 1', exit_code: 1},
      })
      .mockResolvedValueOnce({success: true, output: 'step3\n', error: null});

    const job = buildJob([{position: 0}, {position: 1}, {position: 2}]);

    const result = await executeJob(job);

    expect(result.status).toBe('failed');
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]?.status).toBe('succeeded');
    expect(result.steps[1]).toEqual({
      step_id: job.steps[1]?.id,
      status: 'failed',
      error: {message: 'Command exited with code 1', exit_code: 1},
    });
    expect(mockExecuteRunStep).toHaveBeenCalledTimes(2);
  });

  it('propagates signal-kill error shape from a failed step', async () => {
    mockExecuteRunStep.mockResolvedValueOnce({
      success: false,
      output: '',
      error: {message: 'Killed by signal SIGKILL', exit_code: null, signal: 'SIGKILL'},
    });

    const job = buildJob([{position: 0}]);

    const result = await executeJob(job);

    expect(result.status).toBe('failed');
    expect(result.steps[0]?.error).toEqual({
      message: 'Killed by signal SIGKILL',
      exit_code: null,
      signal: 'SIGKILL',
    });
  });

  it('forwards cwd to executeRunStep', async () => {
    mockExecuteRunStep.mockResolvedValue({success: true, output: '', error: null});

    const job = buildJob([{position: 0}]);

    await executeJob(job, {cwd: '/tmp/shipfox-job-x'});

    expect(mockExecuteRunStep).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({cwd: '/tmp/shipfox-job-x'}),
    );
  });

  it('handles a single step job', async () => {
    mockExecuteRunStep.mockResolvedValue({success: true, output: 'done\n', error: null});

    const job = buildJob([{position: 0}]);

    const result = await executeJob(job);

    expect(result.status).toBe('succeeded');
    expect(result.steps).toHaveLength(1);
  });
});

function buildJob(steps: Array<{position: number; name?: string}>): JobPayloadDto {
  return {
    job_id: '00000000-0000-0000-0000-000000000001',
    run_id: '00000000-0000-0000-0000-000000000002',
    job_name: 'test-job',
    steps: steps.map((s, i) => ({
      id: `00000000-0000-0000-0000-00000000000${i}`,
      name: s.name ?? null,
      type: 'run',
      config: {run: 'echo test'},
      position: s.position,
    })),
  };
}
