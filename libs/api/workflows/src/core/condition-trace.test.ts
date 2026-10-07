import {
  createWorkflowExpression,
  evaluatePlannedPredicateAtSite,
  type WorkflowPredicateField,
} from '@shipfox/expression';
import {explicitConditionTrace} from './condition-trace.js';

function conditionTraceFor(params: {
  source: string;
  field: 'job.if' | 'step.if';
  site: 'job-activation' | 'step-dispatch';
  values: Record<string, unknown>;
}) {
  const expression = createWorkflowExpression({source: params.source, check: {mode: 'syntax'}});
  const field: WorkflowPredicateField = params.field;
  const outcome = evaluatePlannedPredicateAtSite({
    expression,
    field,
    site: params.site,
    context: params.values,
  });
  const [entry] = explicitConditionTrace({
    expression,
    field: params.field,
    route: outcome.route,
    site: params.site,
    value: outcome.value,
    degraded: outcome.evaluationFailed,
    error: outcome.error,
    values: params.values,
  });
  return entry;
}

describe('explicitConditionTrace', () => {
  test('names a skipped job as the source of a missing job output', () => {
    const entry = conditionTraceFor({
      source: 'jobs.write.outputs.created_branch != ""',
      field: 'job.if',
      site: 'job-activation',
      values: {jobs: {write: {key: 'write', status: 'skipped', outputs: {}}}},
    });

    expect(entry).toMatchObject({
      degraded: true,
      error: {
        message: 'No such key: created_branch',
        path: 'jobs.write.outputs.created_branch',
        source: {kind: 'job', key: 'write', status: 'skipped'},
      },
    });
  });

  test('names a succeeded step as the source of an output it did not report', () => {
    const entry = conditionTraceFor({
      source: 'steps.fix.outputs.status == "implemented"',
      field: 'step.if',
      site: 'step-dispatch',
      values: {steps: {fix: {status: 'succeeded', outputs: {}}}},
    });

    expect(entry).toMatchObject({
      degraded: true,
      error: {
        message: 'No such key: status',
        path: 'steps.fix.outputs.status',
        source: {kind: 'step', key: 'fix', status: 'succeeded'},
      },
    });
  });

  test('finds a needed job by key in the needs list', () => {
    const entry = conditionTraceFor({
      source: 'needs.build.outputs.sha != ""',
      field: 'job.if',
      site: 'job-activation',
      values: {needs: [{key: 'build', status: 'failed', outputs: {}}]},
    });

    expect(entry).toMatchObject({
      error: {
        path: 'needs.build',
        source: {kind: 'job', key: 'build', status: 'failed'},
      },
    });
  });

  test('leaves the source out when the path reads no step or job', () => {
    const entry = conditionTraceFor({
      source: 'vars.TOKEN == "prod"',
      field: 'step.if',
      site: 'step-dispatch',
      values: {vars: {}},
    });

    expect(entry).toMatchObject({
      error: {message: 'No such key: TOKEN', path: 'vars.TOKEN'},
    });
    expect(entry).not.toHaveProperty('error.source');
  });

  test('leaves the source out when the step or job is not in the context', () => {
    const entry = conditionTraceFor({
      source: 'jobs.ghost.outputs.sha != ""',
      field: 'job.if',
      site: 'job-activation',
      values: {jobs: {}},
    });

    expect(entry).toMatchObject({error: {path: 'jobs.ghost'}});
    expect(entry).not.toHaveProperty('error.source');
  });

  test('records no error for a condition that evaluates', () => {
    const entry = conditionTraceFor({
      source: 'jobs.write.status == "skipped"',
      field: 'job.if',
      site: 'job-activation',
      values: {jobs: {write: {status: 'skipped', outputs: {}}}},
    });

    expect(entry).not.toHaveProperty('error');
  });
});
