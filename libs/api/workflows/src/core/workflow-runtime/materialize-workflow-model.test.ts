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
      displayName: 'Set up job',
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
            displayName: 'install',
            status: 'pending',
            type: 'run',
            config: {run: 'npm install'},
            position: 1,
          },
          {
            sourceName: null,
            displayName: 'npm run build',
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
            displayName: 'npm test',
            status: 'pending',
            type: 'run',
            config: {run: 'npm test'},
            position: 1,
          },
        ],
      },
    ]);
  });

  it('materializes an agent step as type "agent" with its config, alongside run steps', () => {
    const model = workflowModel({
      jobs: {
        fix: {
          steps: [
            {run: 'npm install'},
            {
              name: 'implement',
              model: 'claude-opus-4-8',
              provider: 'anthropic',
              thinking: 'high',
              prompt: 'Fix the tests.',
            },
            {
              model: 'gpt-5.1',
              provider: 'openai',
              thinking: 'low',
              prompt: 'Review it.',
              gate: {
                successIf: expression('exit_code == 0'),
                onFailure: {restartFrom: 'implement'},
              },
            },
          ],
        },
      },
    });

    const rows = materializeWorkflowModel(model);

    expect(rows[0]?.steps[2]).toEqual({
      sourceName: 'implement',
      displayName: 'implement',
      status: 'pending',
      type: 'agent',
      config: {
        model: 'claude-opus-4-8',
        provider: 'anthropic',
        thinking: 'high',
        prompt: 'Fix the tests.',
      },
      position: 2,
    });
    expect(rows[0]?.steps[3]).toEqual({
      sourceName: null,
      displayName: 'gpt-5.1 · Review it.',
      status: 'pending',
      type: 'agent',
      config: {
        model: 'gpt-5.1',
        provider: 'openai',
        thinking: 'low',
        prompt: 'Review it.',
        gate: {
          success_if: {language: 'cel', check: 'typed', source: 'exit_code == 0'},
          on_failure: {restart_from: 'implement'},
        },
      },
      position: 3,
    });
  });

  it('gives a job with no user steps just the synthetic setup step', () => {
    const model = workflowModel({jobs: {noop: {steps: []}}});

    const rows = materializeWorkflowModel(model);

    expect(rows[0]?.steps).toEqual([
      {
        sourceName: 'Set up job',
        displayName: 'Set up job',
        status: 'pending',
        type: 'setup',
        config: {},
        position: 0,
      },
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
