import {jobDtoSchema} from './job.js';

const baseJob = {
  id: '11111111-1111-4111-8111-111111111111',
  run_attempt_id: '22222222-2222-4222-8222-222222222222',
  key: 'build',
  name: 'build',
  mode: 'one_shot',
  status: 'pending',
  status_reason: null,
  evaluation_trace: null,
  carried_over: false,
  listening: null,
  listener_status: 'inactive',
  resolution_reason: null,
  outputs: null,
  dependencies: [],
  position: 0,
  created_at: '2026-06-21T12:00:00.000Z',
  updated_at: '2026-06-21T12:01:00.000Z',
};

describe('job DTO schema', () => {
  it('accepts a job without execution timing fields', () => {
    const result = jobDtoSchema.parse(baseJob);

    expect(result).toMatchObject(baseJob);
  });

  it.each([
    'default_gate_rejected',
    'condition_rejected',
    'condition_errored',
  ] as const)('accepts job skip reason "%s"', (statusReason) => {
    const result = jobDtoSchema.parse({
      ...baseJob,
      status: 'skipped',
      status_reason: statusReason,
    });

    expect(result.status_reason).toBe(statusReason);
  });

  it('accepts a skipped job with its condition trace', () => {
    const result = jobDtoSchema.parse({
      ...baseJob,
      status: 'skipped',
      status_reason: 'condition_rejected',
      evaluation_trace: [
        {
          field: 'job.if',
          expression: "jobs.build.status == 'failed'",
          roots: ['jobs'],
          fill_target: 'job-activation',
          evaluated_at: 'job-activation',
          value: 'false',
        },
      ],
    });

    expect(result.evaluation_trace).toHaveLength(1);
  });
});
