import {
  InvalidAgentModelError,
  UnsupportedAgentProviderError,
} from '@shipfox/api-agent/core/errors';
import type {AgentDefaultsResolver} from '@shipfox/api-agent/core/resolve-agent-config';
import type {WorkflowModel} from '@shipfox/api-definitions';
import {AgentConfigUnresolvableError, InterpolationUnresolvableError} from '#core/errors.js';
import {workflowModel} from '#test/index.js';
import {materializeWorkflowModel, modelHasAgentStep} from './materialize-workflow-model.js';

type TestWorkflowExpression = NonNullable<
  NonNullable<WorkflowModel['jobs'][number]['steps'][number]['gate']>['successIf']
>;

function expression(source: string): TestWorkflowExpression {
  return {language: 'cel', check: 'typed', source: source as TestWorkflowExpression['source']};
}

function template(source: string): string {
  return `\${{ ${source} }}`;
}

function shellRef(name: string): string {
  return `\${${name}}`;
}

function runContext(overrides: Record<string, unknown> = {}) {
  return {
    run: {
      id: 'run-1',
      name: 'Build',
      definition_id: 'def-1',
      project_id: 'proj-1',
      workspace_id: 'workspace-1',
      created_at: new Date('2026-06-30T12:00:00.000Z'),
      ...overrides,
    },
    trigger: {source: 'manual', event: 'fire'},
    event: null,
    inputs: null,
  };
}

describe('materializeWorkflowModel', () => {
  it('converts workflow model jobs and steps to runtime rows', () => {
    const model = workflowModel({
      runner: 'ubuntu-latest',
      jobs: {
        build: {
          steps: [
            {
              key: 'install',
              name: 'install',
              run: 'npm install',
              sourceLocation: {startLine: 5, endLine: 6},
            },
            {
              run: 'npm run build',
              sourceLocation: {startLine: 7, endLine: 14},
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

    const rows = materializeWorkflowModel({model});

    const setupStep = {
      key: null,
      name: 'Set up job',
      sourceLocation: null,
      status: 'pending',
      type: 'setup',
      config: {},
      authoredConfig: null,
      position: 0,
    };

    expect(rows).toEqual([
      {
        key: 'build',
        mode: 'one_shot',
        dependencies: [],
        runner: ['ubuntu-latest'],
        position: 0,
        steps: [
          setupStep,
          {
            key: 'install',
            name: 'install',
            sourceLocation: {startLine: 5, endLine: 6},
            status: 'pending',
            type: 'run',
            config: {run: 'npm install'},
            authoredConfig: null,
            position: 1,
          },
          {
            key: null,
            name: 'npm run build',
            sourceLocation: {startLine: 7, endLine: 14},
            status: 'pending',
            type: 'run',
            config: {
              run: 'npm run build',
              gate: {
                success_if: {language: 'cel', check: 'typed', source: 'exit_code == 0'},
                on_failure: {restart_from: 'install', output: 'Build failed'},
              },
            },
            authoredConfig: null,
            position: 2,
          },
        ],
      },
      {
        key: 'test',
        mode: 'one_shot',
        dependencies: ['build'],
        runner: ['ubuntu-latest', 'node-22'],
        position: 1,
        steps: [
          setupStep,
          {
            key: null,
            name: 'npm test',
            sourceLocation: null,
            status: 'pending',
            type: 'run',
            config: {run: 'npm test'},
            authoredConfig: null,
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
              key: 'implement',
              name: 'implement',
              model: 'claude-opus-4-8',
              provider: 'anthropic',
              thinking: 'high',
              prompt: 'Fix the tests.',
            },
            {
              model: 'gpt-5.5-pro',
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

    const rows = materializeWorkflowModel({model});

    expect(rows[0]?.steps[2]).toEqual({
      key: 'implement',
      name: 'implement',
      sourceLocation: null,
      status: 'pending',
      type: 'agent',
      config: {
        model: 'claude-opus-4-8',
        provider: 'anthropic',
        thinking: 'high',
        prompt: 'Fix the tests.',
      },
      authoredConfig: null,
      position: 2,
    });
    expect(rows[0]?.steps[3]).toEqual({
      key: null,
      name: 'gpt-5.5-pro · Review it.',
      sourceLocation: null,
      status: 'pending',
      type: 'agent',
      config: {
        model: 'gpt-5.5-pro',
        provider: 'openai',
        thinking: 'low',
        prompt: 'Review it.',
        gate: {
          success_if: {language: 'cel', check: 'typed', source: 'exit_code == 0'},
          on_failure: {restart_from: 'implement'},
        },
      },
      authoredConfig: null,
      position: 3,
    });
  });

  it('materializes prompt-only agent steps with catalog defaults before runner execution', () => {
    const model = workflowModel({
      jobs: {
        fix: {
          steps: [{prompt: 'Fix the failing tests.'}],
        },
      },
    });

    const rows = materializeWorkflowModel({model});

    expect(rows[0]?.steps[1]).toEqual({
      key: null,
      name: 'Fix the failing tests.',
      sourceLocation: null,
      status: 'pending',
      type: 'agent',
      config: {
        model: 'claude-opus-4-8',
        provider: 'anthropic',
        thinking: 'high',
        prompt: 'Fix the failing tests.',
      },
      authoredConfig: null,
      position: 1,
    });
  });

  it('materializes provider-only agent steps with that provider catalog default model', () => {
    const model = workflowModel({
      jobs: {
        fix: {
          steps: [{provider: 'openai', prompt: 'Fix the failing tests.'}],
        },
      },
    });

    const rows = materializeWorkflowModel({model});

    expect(rows[0]?.steps[1]?.config).toEqual({
      model: 'gpt-5.5-pro',
      provider: 'openai',
      thinking: 'high',
      prompt: 'Fix the failing tests.',
    });
  });

  it('routes agent steps through the provided resolver', () => {
    const model = workflowModel({
      jobs: {
        fix: {
          steps: [{provider: 'anthropic', prompt: 'Fix the failing tests.'}],
        },
      },
    });
    const resolveAgentDefaults = vi.fn<AgentDefaultsResolver>().mockReturnValue({
      provider: 'openai',
      model: 'gpt-5.5-pro',
      thinking: 'medium',
    });

    const rows = materializeWorkflowModel({model, resolveAgentDefaults, definitionId: 'def-1'});

    expect(resolveAgentDefaults).toHaveBeenCalledWith({
      provider: 'anthropic',
      model: undefined,
      thinking: undefined,
    });
    expect(rows[0]?.steps[1]).toMatchObject({
      name: 'Fix the failing tests.',
      config: {
        model: 'gpt-5.5-pro',
        provider: 'openai',
        thinking: 'medium',
        prompt: 'Fix the failing tests.',
      },
    });
  });

  it.each([
    new UnsupportedAgentProviderError('unknown-provider'),
    new InvalidAgentModelError('anthropic', 'missing-model'),
  ])('wraps known resolver errors as permanent agent config errors', (cause) => {
    const model = workflowModel({
      jobs: {
        fix: {steps: [{prompt: 'Fix the failing tests.'}]},
      },
    });
    const resolveAgentDefaults = vi.fn<AgentDefaultsResolver>().mockImplementation(() => {
      throw cause;
    });

    const materialize = () =>
      materializeWorkflowModel({model, resolveAgentDefaults, definitionId: 'def-1'});

    expect(materialize).toThrow(AgentConfigUnresolvableError);
    expect(materialize).toThrow('Agent configuration cannot be resolved for definition def-1');
  });

  it('re-throws unknown resolver errors unchanged', () => {
    const model = workflowModel({
      jobs: {
        fix: {steps: [{prompt: 'Fix the failing tests.'}]},
      },
    });
    const error = new Error('database unavailable');
    const resolveAgentDefaults = vi.fn<AgentDefaultsResolver>().mockImplementation(() => {
      throw error;
    });

    const materialize = () =>
      materializeWorkflowModel({model, resolveAgentDefaults, definitionId: 'def-1'});

    expect(materialize).toThrow(error);
  });

  it('materializes merged env for run steps only', () => {
    const model = workflowModel({
      env: {SHARED: 'workflow', WORKFLOW_ONLY: 'yes'},
      jobs: {
        build: {
          env: {SHARED: 'job', JOB_ONLY: 'yes'},
          steps: [
            {name: 'run', run: 'npm test', env: {SHARED: 'step', STEP_ONLY: 'yes'}},
            {
              name: 'agent',
              model: 'claude-opus-4-8',
              provider: 'anthropic',
              thinking: 'high',
              prompt: 'Fix it.',
            },
          ],
        },
      },
    });

    const rows = materializeWorkflowModel({model});

    expect(rows[0]?.steps[0]?.config).toEqual({});
    expect(rows[0]?.steps[1]?.config).toEqual({
      run: 'npm test',
      env: {
        SHARED: 'step',
        WORKFLOW_ONLY: 'yes',
        JOB_ONLY: 'yes',
        STEP_ONLY: 'yes',
      },
    });
    expect(rows[0]?.steps[2]?.config).toEqual({
      model: 'claude-opus-4-8',
      provider: 'anthropic',
      thinking: 'high',
      prompt: 'Fix it.',
    });
  });

  it('omits env from run-step config when the merge is empty', () => {
    const model = workflowModel({
      jobs: {
        build: {
          steps: [{run: 'npm test'}],
        },
      },
    });

    const rows = materializeWorkflowModel({model});

    expect(rows[0]?.steps[1]?.config).toEqual({run: 'npm test'});
  });

  it('hoists run interpolation into generated env vars with shell references', () => {
    const model = workflowModel({
      jobs: {
        build: {
          steps: [{run: `echo "${template('run.id')}" && echo "${template('run.created_at')}"`}],
        },
      },
    });

    const rows = materializeWorkflowModel({model, context: runContext()});

    expect(rows[0]?.steps[1]?.config).toEqual({
      run: `echo "${shellRef('__sf_0')}" && echo "${shellRef('__sf_1')}"`,
      env: {
        __sf_0: 'run-1',
        __sf_1: '2026-06-30T12:00:00.000Z',
      },
    });
    expect(rows[0]?.steps[1]?.authoredConfig).toEqual({
      run: `echo "${template('run.id')}" && echo "${template('run.created_at')}"`,
    });
  });

  it('merges env before resolving and only resolves the winning values', () => {
    const model = workflowModel({
      env: {SHARED: template('event.missing'), WORKFLOW_ONLY: template('run.id')},
      jobs: {
        build: {
          env: {JOB_ONLY: template('trigger.source')},
          steps: [
            {
              run: 'echo ok',
              env: {SHARED: 'step', __sf_0: 'reserved'},
            },
          ],
        },
      },
    });

    const rows = materializeWorkflowModel({model, context: runContext()});

    expect(rows[0]?.steps[1]?.config).toEqual({
      run: 'echo ok',
      env: {
        SHARED: 'step',
        WORKFLOW_ONLY: 'run-1',
        JOB_ONLY: 'manual',
        __sf_0: 'reserved',
      },
    });
    expect(rows[0]?.steps[1]?.authoredConfig).toEqual({
      run: 'echo ok',
      env: {
        SHARED: 'step',
        WORKFLOW_ONLY: template('run.id'),
        JOB_ONLY: template('trigger.source'),
        __sf_0: 'reserved',
      },
    });
    expect(rows[0]?.steps[1]?.diagnostics).toBeUndefined();
  });

  it('records missing untrusted env paths as diagnostics', () => {
    const model = workflowModel({
      jobs: {
        build: {
          steps: [{run: 'echo ok', env: {REF: template('event.ref')}}],
        },
      },
    });

    const rows = materializeWorkflowModel({model, context: {...runContext(), event: {}}});

    expect(rows[0]?.steps[1]?.config).toEqual({
      run: 'echo ok',
      env: {REF: ''},
    });
    expect(rows[0]?.steps[1]?.diagnostics).toEqual([
      {
        reason: 'missing-path',
        expression: 'event.ref',
        contextRoots: ['event'],
        field: 'env',
        envKey: 'REF',
      },
    ]);
  });

  it('reserves user env names when generating run interpolation env vars', () => {
    const model = workflowModel({
      jobs: {
        build: {
          steps: [{run: `echo "${template('run.id')}"`, env: {__sf_0: 'user'}}],
        },
      },
    });

    const rows = materializeWorkflowModel({model, context: runContext()});

    expect(rows[0]?.steps[1]?.config).toEqual({
      run: `echo "${shellRef('__sf_1')}"`,
      env: {__sf_0: 'user', __sf_1: 'run-1'},
    });
  });

  it('resolves agent prompt, model, and provider before catalog defaults', () => {
    const model = workflowModel({
      jobs: {
        fix: {
          steps: [
            {
              provider: template('trigger.source'),
              model: template('run.name'),
              prompt: `Fix ${template('run.id')}`,
            },
          ],
        },
      },
    });
    const resolveAgentDefaults = vi.fn<AgentDefaultsResolver>().mockReturnValue({
      provider: 'openai',
      model: 'gpt-5.5-pro',
      thinking: 'medium',
    });

    const rows = materializeWorkflowModel({
      model,
      context: {...runContext({name: 'gpt-5.5-pro'}), trigger: {source: 'openai', event: 'fire'}},
      resolveAgentDefaults,
      definitionId: 'def-1',
    });

    expect(resolveAgentDefaults).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'gpt-5.5-pro',
      thinking: undefined,
    });
    expect(rows[0]?.steps[1]?.config).toEqual({
      provider: 'openai',
      model: 'gpt-5.5-pro',
      thinking: 'medium',
      prompt: 'Fix run-1',
    });
    expect(rows[0]?.steps[1]?.authoredConfig).toEqual({
      provider: template('trigger.source'),
      model: template('run.name'),
      prompt: `Fix ${template('run.id')}`,
    });
  });

  it('throws a permanent interpolation error for unsafe run interpolation', () => {
    const model = workflowModel({
      jobs: {
        build: {steps: [{run: `echo \`${template('run.id')}\``}]},
      },
    });

    const materialize = () =>
      materializeWorkflowModel({model, context: runContext(), definitionId: 'def-1'});

    expect(materialize).toThrow(InterpolationUnresolvableError);
  });

  it('throws a permanent interpolation error for a missing trusted run path', () => {
    const model = workflowModel({
      jobs: {
        build: {steps: [{run: `echo "${template('run.id')}"`}]},
      },
    });

    const materialize = () => materializeWorkflowModel({model, context: {}, definitionId: 'def-1'});

    expect(materialize).toThrow(InterpolationUnresolvableError);
  });

  it('throws a permanent interpolation error for a missing execution path in step names', () => {
    const model = workflowModel({
      jobs: {
        review: {
          steps: [
            {
              name: `Review ${template('execution.events[0].data.body')}`,
              prompt: 'Summarize the review',
            },
          ],
        },
      },
    });

    const materialize = () =>
      materializeWorkflowModel({model, context: runContext(), definitionId: 'def-1'});

    expect(materialize).toThrow(InterpolationUnresolvableError);
  });

  it('uses the supplied context for each materialization call', () => {
    const model = workflowModel({
      jobs: {
        build: {steps: [{run: `echo "${template('run.id')}"`}]},
      },
    });

    const first = materializeWorkflowModel({model, context: runContext({id: 'run-a'})});
    const second = materializeWorkflowModel({model, context: runContext({id: 'run-b'})});

    expect(first[0]?.steps[1]?.config).toMatchObject({env: {__sf_0: 'run-a'}});
    expect(second[0]?.steps[1]?.config).toMatchObject({env: {__sf_0: 'run-b'}});
  });

  it('gives a job with no user steps just the synthetic setup step', () => {
    const model = workflowModel({jobs: {noop: {steps: []}}});

    const rows = materializeWorkflowModel({model});

    expect(rows[0]?.steps).toEqual([
      {
        key: null,
        name: 'Set up job',
        sourceLocation: null,
        status: 'pending',
        type: 'setup',
        config: {},
        authoredConfig: null,
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
          key: 'test',
          mode: 'one_shot',
          runner: [],
          dependencies: ['missing'],
          steps: [],
        },
      ],
      dependencies: [{from: 'missing', to: 'test'}],
    };

    expect(() => materializeWorkflowModel({model})).toThrow(
      'Unresolved workflow model dependency "missing" for job "test"',
    );
  });

  it('detects whether a workflow model contains agent steps', () => {
    const runOnly = workflowModel();
    const withAgent = workflowModel({
      jobs: {
        fix: {steps: [{prompt: 'Fix the failing tests.'}]},
      },
    });

    expect(modelHasAgentStep(runOnly)).toBe(false);
    expect(modelHasAgentStep(withAgent)).toBe(true);
  });
});
