import type {WorkflowModel} from '@shipfox/api-definitions';
import {workflowModel} from '#test/index.js';
import {materializeWorkflowModel} from './materialize-workflow-model.js';

type TestWorkflowExpression = NonNullable<
  NonNullable<WorkflowModel['jobs'][number]['steps'][number]['gate']>['successIf']
>;

function expression(source: string): TestWorkflowExpression {
  return {language: 'cel', check: 'typed', source: source as TestWorkflowExpression['source']};
}

describe('materializeWorkflowModel', () => {
  it('converts workflow model jobs and steps to runtime rows', () => {
    const model = workflowModel({
      runner: 'ubuntu-latest',
      jobs: {
        build: {
          steps: [
            {name: 'install', run: 'npm install'},
            {
              run: 'npm run build',
              gate: {
                successIf: expression('exit_code == 0'),
                onFailure: {restartFrom: 'install', output: 'Build failed'},
              },
            },
          ],
        },
        test: {
          needs: 'build',
          runner: ['ubuntu-latest', 'node-22'],
          steps: [{run: 'npm test'}],
        },
      },
    });

    const rows = materializeWorkflowModel(model);

    const setupStep = {
      sourceName: 'Set up job',
      status: 'pending',
      type: 'setup',
      config: {},
      position: 0,
    };

    expect(rows).toEqual([
      {
        sourceName: 'build',
        dependencies: [],
        runner: ['ubuntu-latest'],
        position: 0,
        steps: [
          setupStep,
          {
            sourceName: 'install',
            status: 'pending',
            type: 'run',
            config: {run: 'npm install'},
            position: 1,
          },
          {
            sourceName: null,
            status: 'pending',
            type: 'run',
            config: {
              run: 'npm run build',
              gate: {
                success_if: {language: 'cel', check: 'typed', source: 'exit_code == 0'},
                on_failure: {restart_from: 'install', output: 'Build failed'},
              },
            },
            position: 2,
          },
        ],
      },
      {
        sourceName: 'test',
        dependencies: ['build'],
        runner: ['ubuntu-latest', 'node-22'],
        position: 1,
        steps: [
          setupStep,
          {
            sourceName: null,
            status: 'pending',
            type: 'run',
            config: {run: 'npm test'},
            position: 1,
          },
        ],
      },
    ]);
  });

  it('gives a job with no user steps just the synthetic setup step', () => {
    const model = workflowModel({jobs: {noop: {steps: []}}});

    const rows = materializeWorkflowModel(model);

    expect(rows[0]?.steps).toEqual([
      {sourceName: 'Set up job', status: 'pending', type: 'setup', config: {}, position: 0},
    ]);
  });

  it('fails fast when the model contains an unresolved dependency id', () => {
    const model: WorkflowModel = {
      ...workflowModel(),
      jobs: [
        {
          id: 'test',
          sourceName: 'test',
          runner: [],
          dependencies: ['missing'],
          steps: [],
        },
      ],
      dependencies: [{from: 'missing', to: 'test'}],
    };

    expect(() => materializeWorkflowModel(model)).toThrow(
      'Unresolved workflow model dependency "missing" for job "test"',
    );
  });
});
