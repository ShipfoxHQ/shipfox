import {runAfterSkipDescription} from './condition-error.js';
import type {EvaluationTraceValueEntry} from './entities/step-attempt.js';

describe('runAfterSkipDescription', () => {
  test('tells the reader which value runs a step after an earlier failure', () => {
    const description = runAfterSkipDescription('step', [gateTrace('!execution.failed')]);

    expect(description).toBe(
      'An earlier step in this job failed, so Shipfox skipped this step. To run it after a failure, set `run_after: always` or `run_after: failure` on the step.',
    );
  });

  test('explains a step that waits for a failure when no step failed', () => {
    const description = runAfterSkipDescription('step', [gateTrace('execution.failed')]);

    expect(description).toBe('No earlier step failed, so this step did not run.');
  });

  test('explains a job that waits for a failure when no needed job failed', () => {
    const description = runAfterSkipDescription('job', [
      gateTrace('needs.exists(n, n.status == "failed")', 'job.default_gate'),
    ]);

    expect(description).toBe('No job in `needs` failed, so this job did not run.');
  });

  test('uses the default explanation when the job has no trace', () => {
    const description = runAfterSkipDescription('job', null);

    expect(description).toBe(
      'A job in the `needs` of this job did not succeed, so Shipfox skipped this job. To run it after a failure, set `run_after: always` or `run_after: failure` on the job.',
    );
  });
});

function gateTrace(expression: string, field = 'step.default_gate'): EvaluationTraceValueEntry {
  return {
    expression,
    roots: [],
    fillTarget: 'step-dispatch',
    evaluatedAt: 'step-dispatch',
    field,
    value: 'false',
  };
}
