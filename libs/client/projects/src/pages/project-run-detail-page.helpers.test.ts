import type {DetailJob, DetailStep} from './project-run-detail-page-helpers.js';
import {
  pickInterestingJob,
  pickInterestingStep,
  sourceLineDescriptors,
} from './project-run-detail-page-helpers.js';

describe('project run detail helpers', () => {
  test('picks failed job before running and first job', () => {
    const pending = job({id: 'pending', status: 'pending'});
    const running = job({id: 'running', status: 'running'});
    const failed = job({id: 'failed', status: 'failed'});

    const result = pickInterestingJob([pending, running, failed]);

    expect(result?.id).toBe('failed');
  });

  test('picks running job before first job when none failed', () => {
    const pending = job({id: 'pending', status: 'pending'});
    const running = job({id: 'running', status: 'running'});

    const result = pickInterestingJob([pending, running]);

    expect(result?.id).toBe('running');
  });

  test('picks failed step before running, attempted, and first step', () => {
    const pending = step({id: 'pending', status: 'pending'});
    const attempted = step({id: 'attempted', status: 'succeeded', attempts: [{}]});
    const running = step({id: 'running', status: 'running'});
    const failed = step({id: 'failed', status: 'failed'});

    const result = pickInterestingStep([pending, attempted, running, failed]);

    expect(result?.id).toBe('failed');
  });

  test('picks attempted step before first step when none failed or running', () => {
    const pending = step({id: 'pending', status: 'pending'});
    const attempted = step({id: 'attempted', status: 'succeeded', attempts: [{}]});

    const result = pickInterestingStep([pending, attempted]);

    expect(result?.id).toBe('attempted');
  });

  test('describes YAML lines with stable offsets', () => {
    const result = sourceLineDescriptors('name: demo\nsteps:\n');

    expect(result).toEqual([
      {id: '0', number: 1, text: 'name: demo'},
      {id: '11', number: 2, text: 'steps:'},
      {id: '18', number: 3, text: ''},
    ]);
  });
});

function job({id, status}: {id: string; status: string}): DetailJob {
  return {
    id,
    run_id: 'run-1',
    name: id,
    status,
    dependencies: [],
    position: 0,
    duration_ms: 0,
    created_at: '2026-05-13T00:00:00.000Z',
    updated_at: '2026-05-13T00:00:00.000Z',
    steps: [],
  };
}

function step({
  id,
  status,
  attempts = [],
}: {
  id: string;
  status: string;
  attempts?: Array<Partial<DetailStep['attempts'][number]>>;
}): DetailStep {
  return {
    id,
    job_id: 'job-1',
    name: id,
    status,
    type: 'command',
    config: {},
    error: null,
    position: 0,
    current_attempt: 1,
    duration_ms: 0,
    created_at: '2026-05-13T00:00:00.000Z',
    updated_at: '2026-05-13T00:00:00.000Z',
    attempts: attempts.map((attempt, index) => ({
      id: `attempt-${index + 1}`,
      step_id: id,
      job_id: 'job-1',
      attempt: index + 1,
      status: 'succeeded',
      output: null,
      error: null,
      exit_code: 0,
      gate_result: null,
      restart_reason: null,
      started_at: '2026-05-13T00:00:00.000Z',
      finished_at: '2026-05-13T00:00:00.000Z',
      ...attempt,
    })),
  };
}
