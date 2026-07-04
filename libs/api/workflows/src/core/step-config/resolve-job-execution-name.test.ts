import {workflowModel} from '#test/index.js';
import {resolveJobExecutionName} from './resolve-job-execution-name.js';

function template(source: string): string {
  return `\${{ ${source} }}`;
}

describe('resolveJobExecutionName', () => {
  it('resolves an interpolated job name at execution creation', () => {
    const [job] = workflowModel({
      jobs: {
        deploy: {
          name: `Deploy ${template('inputs.environment')}`,
          steps: [{run: 'echo deploy'}],
        },
      },
    }).jobs;
    if (!job) throw new Error('Missing deploy job');

    const name = resolveJobExecutionName({
      definitionId: 'definition-1',
      job,
      fallbackName: 'deploy #1',
      context: {inputs: {environment: 'prod'}},
    });

    expect(name).toBe('Deploy prod');
  });

  it('falls back when the name template resolves to an empty string', () => {
    const [job] = workflowModel({
      jobs: {
        deploy: {
          name: template('inputs.environment'),
          steps: [{run: 'echo deploy'}],
        },
      },
    }).jobs;
    if (!job) throw new Error('Missing deploy job');

    const name = resolveJobExecutionName({
      definitionId: 'definition-1',
      job,
      fallbackName: 'deploy #1',
      context: {inputs: {environment: ''}},
    });

    expect(name).toBe('deploy #1');
  });

  it('falls back when the job has no name template', () => {
    const [job] = workflowModel({
      jobs: {
        deploy: {
          steps: [{run: 'echo deploy'}],
        },
      },
    }).jobs;
    if (!job) throw new Error('Missing deploy job');

    const name = resolveJobExecutionName({
      definitionId: 'definition-1',
      job,
      fallbackName: 'deploy #1',
      context: {},
    });

    expect(name).toBe('deploy #1');
  });
});
