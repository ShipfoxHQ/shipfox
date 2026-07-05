import type {AgentDefaultsResolver} from '@shipfox/api-agent/core/resolve-agent-config';
import {parseWorkflowTemplate, planInterpolationField} from '@shipfox/expression';
import type {Step} from '#core/entities/step.js';
import {InterpolationUnresolvableError} from '#core/errors.js';
import {completeStepDispatchConfig} from './complete-step-dispatch-config.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

function plannedField(source: string) {
  const plan = planInterpolationField({
    field: 'env.value',
    segments: parseWorkflowTemplate(source),
  });
  if (!plan.ok) throw new Error('Expected field plan to be valid');
  return plan.plan.field;
}

function template(source: string): string {
  return '$'.concat('{{ ', source, ' }}');
}

function step(overrides: Partial<Step>): Step {
  return {
    id: 'step-1',
    jobExecutionId: 'exec-1',
    key: 'deploy',
    name: 'Deploy',
    sourceLocation: null,
    status: 'pending',
    type: 'run',
    config: {},
    configPlan: null,
    authoredConfig: null,
    error: null,
    position: 1,
    version: 1,
    currentAttempt: 1,
    createdAt: new Date('2026-06-30T12:00:00.000Z'),
    updatedAt: new Date('2026-06-30T12:00:00.000Z'),
    ...overrides,
  };
}

const context: WorkflowEvaluationContext = {
  site: 'step-dispatch',
  values: {
    steps: {
      build: {
        outputs: {sha: 'abc123'},
      },
    },
  },
};

const resolveAgentDefaults: AgentDefaultsResolver = (params) => ({
  harness: params.harness ?? 'pi',
  provider: params.provider ?? 'openai',
  model: params.model ?? 'gpt-5.5',
  thinking: params.thinking ?? 'off',
});

describe('completeStepDispatchConfig', () => {
  it('serializes residual secret env values as secret bindings without writing env values', () => {
    const pending = step({
      config: {},
      configPlan: {
        env: {
          TOKEN: plannedField(`prefix-${template('secrets.local.TOKEN')}`),
          SHORT: plannedField(template('secrets.API_KEY')),
        },
      },
    });

    const config = completeStepDispatchConfig({
      step: pending,
      context,
      resolveAgentDefaults,
      definitionId: 'def-1',
    });

    expect(config).toEqual({
      secret_bindings: [
        {
          target: 'TOKEN',
          segments: [
            {kind: 'literal', value: 'prefix-'},
            {kind: 'secret', store: 'local', key: 'TOKEN'},
          ],
        },
        {
          target: 'SHORT',
          segments: [{kind: 'secret', store: 'local', key: 'API_KEY'}],
        },
      ],
    });
  });

  it('rejects secret env bindings with malformed target names', () => {
    const pending = step({
      config: {},
      configPlan: {
        env: {
          'BAD-NAME': plannedField(template('secrets.API_KEY')),
        },
      },
    });

    const act = () =>
      completeStepDispatchConfig({
        step: pending,
        context,
        resolveAgentDefaults,
        definitionId: 'def-1',
      });

    expect(act).toThrow();
  });

  it('keeps fully resolved step config byte-identical apart from resolved env additions', () => {
    const pending = step({
      config: {run: 'echo "$SHA"'},
      configPlan: {
        env: {
          SHA: plannedField(template('steps.build.outputs.sha')),
        },
      },
    });

    const config = completeStepDispatchConfig({
      step: pending,
      context,
      resolveAgentDefaults,
      definitionId: 'def-1',
    });

    expect(config).toEqual({run: 'echo "$SHA"', env: {SHA: 'abc123'}});
  });

  it('completes deferred agent config with the resolved harness', () => {
    const pending = step({
      type: 'agent',
      config: {},
      configPlan: {
        agent: {
          harness: 'claude',
          prompt: plannedField(`Review ${template('steps.build.outputs.sha')}`),
        },
      },
    });

    const config = completeStepDispatchConfig({
      step: pending,
      context,
      resolveAgentDefaults,
      definitionId: 'def-1',
    });

    expect(config).toEqual({
      harness: 'claude',
      provider: 'openai',
      model: 'gpt-5.5',
      thinking: 'off',
      prompt: 'Review abc123',
    });
  });

  it('throws when a server-side segment still survives dispatch', () => {
    const pending = step({
      config: {},
      configPlan: {
        env: {
          STATUS: plannedField(template('step.status')),
        },
      },
    });

    const act = () =>
      completeStepDispatchConfig({
        step: pending,
        context,
        resolveAgentDefaults,
        definitionId: 'def-1',
      });

    expect(act).toThrow(InterpolationUnresolvableError);
  });
});
