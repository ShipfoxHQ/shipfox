import {evaluationTraceSchema} from './evaluation-trace.js';

describe('evaluation trace schema', () => {
  it('accepts value entries with resolved and diagnostic metadata', () => {
    const trace = evaluationTraceSchema.parse([
      {
        expression: 'inputs.environment',
        roots: ['inputs.environment'],
        fill_target: 'agent.prompt',
        evaluated_at: '2026-08-05T12:00:00.000Z',
        field: 'agent.prompt',
        value: 'production',
        reference: true,
        degraded: false,
        env_key: 'ENVIRONMENT',
      },
    ]);

    expect(trace[0]).toMatchObject({
      field: 'agent.prompt',
      value: 'production',
      reference: true,
      env_key: 'ENVIRONMENT',
    });
  });

  it('accepts a condition error with its source and rejects an unknown source kind', () => {
    const entry = {
      expression: 'jobs.write.outputs.created_branch != ""',
      roots: ['jobs'],
      fill_target: 'job-activation',
      evaluated_at: 'job-activation',
      field: 'job.if',
      degraded: true,
    };
    const error = {
      message: 'No such key: created_branch',
      path: 'jobs.write.outputs.created_branch',
      source: {kind: 'job', key: 'write', status: 'skipped'},
    };

    const parsed = evaluationTraceSchema.parse([{...entry, error}]);
    const rejected = evaluationTraceSchema.safeParse([
      {...entry, error: {...error, source: {...error.source, kind: 'run'}}},
    ]);

    expect(parsed[0]).toMatchObject({error});
    expect(rejected.success).toBe(false);
  });

  it('accepts an explicit trace budget marker', () => {
    expect(evaluationTraceSchema.parse([{truncated: true, dropped: 3}])).toEqual([
      {truncated: true, dropped: 3},
    ]);
  });

  it('rejects malformed trace entries', () => {
    const result = evaluationTraceSchema.safeParse([
      {expression: 'inputs.environment', field: 'agent.prompt'},
    ]);

    expect(result.success).toBe(false);
  });
});
