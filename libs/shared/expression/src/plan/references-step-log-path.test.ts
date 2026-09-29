import {referencesStepLogPath} from './references-step-log-path.js';

describe('referencesStepLogPath', () => {
  it.each([
    'steps.build.log_path',
    'steps.build.attempts[0].log_path',
    'steps.build.attempts.map(a, a.log_path)',
    'has(steps.build.log_path)',
    '"Read " + steps.build.log_path',
    'step.restart.from.log_path',
    'has(step.restart.from.log_path) ? step.restart.from.log_path : ""',
    'step.restart.from.attempts[0].log_path',
  ])('detects %s', (source) => {
    expect(referencesStepLogPath(source)).toBe(true);
  });

  it.each([
    'steps.build.outputs.log_path',
    'steps.build.attempts[0].outputs.log_path',
    'step.restart.from.outputs.log_path',
    'step.restart.feedback',
    'jobs.build.outputs.log_path',
    'inputs.log_path',
    'steps.build.exit_code == 0',
  ])('ignores %s', (source) => {
    expect(referencesStepLogPath(source)).toBe(false);
  });
});
