import {
  InvalidAgentModelError,
  UnsupportedModelProviderError,
} from '@shipfox/api-agent/core/errors';
import type {AgentDefaultsResolver} from '@shipfox/api-agent/core/resolve-agent-config';
import {AgentConfigUnresolvableError, InterpolationUnresolvableError} from '#core/errors.js';
import {workflowModel} from '#test/index.js';
import {materializeJobExecutionSteps} from './materialize-job-execution-steps.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

function template(source: string): string {
  return `\${{ ${source} }}`;
}

function shellRef(name: string): string {
  return `\${${name}}`;
}

function jobExecutionContext(): WorkflowEvaluationContext {
  return {
    site: 'execution-creation',
    values: {
      run: {
        id: 'run-1',
        name: 'Reviews',
        definition_id: 'def-1',
        project_id: 'proj-1',
        workspace_id: 'workspace-1',
        created_at: new Date('2026-06-30T12:00:00.000Z'),
      },
      trigger: {source: 'manual', event: 'fire'},
      event: null,
      inputs: null,
      execution: {
        index: 1,
        name: 'Review batch 2',
        status: 'pending',
        started_at: '2026-06-30T12:01:00.000Z',
        finished_at: null,
        events: [
          {
            source: 'github',
            event: 'pull_request_review',
            delivery_id: 'delivery-2',
            received_at: '2026-06-30T12:01:00.000Z',
            data: {body: 'LGTM'},
          },
        ],
      },
      executions: [
        {
          index: 0,
          name: 'Review batch 1',
          status: 'succeeded',
          started_at: '2026-06-30T12:00:00.000Z',
          finished_at: '2026-06-30T12:00:30.000Z',
          events: [],
        },
      ],
    },
  };
}

describe('materializeJobExecutionSteps', () => {
  it('prepends setup and resolves job-execution context fields', () => {
    const model = workflowModel({
      jobs: {
        review: {
          steps: [
            {
              name: `Review ${template('execution.events[0].data.body')}`,
              run: `echo "${template('executions[0].name')}"`,
              env: {BODY: template('execution.events[0].data.body')},
            },
          ],
        },
      },
    });
    const job = model.jobs[0];
    if (!job) throw new Error('Expected workflow job');

    const steps = materializeJobExecutionSteps({model, job, context: jobExecutionContext()});

    expect(steps).toEqual([
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
      {
        key: null,
        name: 'Review LGTM',
        sourceLocation: null,
        status: 'pending',
        type: 'run',
        config: {
          run: `echo "${shellRef('__sf_0')}"`,
          env: {
            BODY: 'LGTM',
            __sf_0: 'Review batch 1',
          },
        },
        authoredConfig: {
          run: `echo "${template('executions[0].name')}"`,
          env: {BODY: template('execution.events[0].data.body')},
        },
        configPlan: {
          trace: [
            {
              expression: 'execution.events[0].data.body',
              roots: ['execution'],
              fillTarget: 'execution-creation',
              evaluatedAt: 'execution-creation',
              value: 'LGTM',
              field: 'env',
              envKey: 'BODY',
            },
            {
              expression: 'executions[0].name',
              roots: ['executions'],
              fillTarget: 'execution-creation',
              evaluatedAt: 'execution-creation',
              value: 'Review batch 1',
              field: 'run',
            },
            {
              expression: 'execution.events[0].data.body',
              roots: ['execution'],
              fillTarget: 'execution-creation',
              evaluatedAt: 'execution-creation',
              value: 'LGTM',
              field: 'step.name',
            },
          ],
        },
        position: 1,
      },
    ]);
  });

  it('throws a permanent interpolation error for available missing value paths', () => {
    const model = workflowModel({
      jobs: {
        review: {
          steps: [{run: 'echo ok', env: {TICKET: template('inputs.ticket')}}],
        },
      },
    });
    const job = model.jobs[0];
    if (!job) throw new Error('Expected workflow job');
    const baseContext = jobExecutionContext();

    let error: unknown;
    try {
      materializeJobExecutionSteps({
        model,
        job,
        context: {...baseContext, values: {...baseContext.values, inputs: {}}},
        definitionId: 'def-1',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InterpolationUnresolvableError);
    expect(error).toMatchObject({
      field: 'env',
      source: 'inputs.ticket',
      envKey: 'TICKET',
    });
  });

  it.each([
    new UnsupportedModelProviderError('unknown-provider'),
    new InvalidAgentModelError('anthropic', 'missing-model'),
  ])('wraps known resolver errors as permanent agent config errors', (cause) => {
    const model = workflowModel({
      jobs: {
        review: {steps: [{prompt: 'Summarize the review.'}]},
      },
    });
    const job = model.jobs[0];
    if (!job) throw new Error('Expected workflow job');
    const resolveAgentDefaults = vi.fn<AgentDefaultsResolver>().mockImplementation(() => {
      throw cause;
    });

    const materialize = () =>
      materializeJobExecutionSteps({
        model,
        job,
        context: jobExecutionContext(),
        resolveAgentDefaults,
        definitionId: 'def-1',
      });

    expect(materialize).toThrow(AgentConfigUnresolvableError);
    expect(materialize).toThrow('Agent configuration cannot be resolved for definition def-1');
  });

  it('throws a permanent interpolation error for unsafe run interpolation', () => {
    const model = workflowModel({
      jobs: {
        review: {steps: [{run: `echo \`${template('execution.index')}\``}]},
      },
    });
    const job = model.jobs[0];
    if (!job) throw new Error('Expected workflow job');

    const materialize = () =>
      materializeJobExecutionSteps({
        model,
        job,
        context: jobExecutionContext(),
        definitionId: 'def-1',
      });

    expect(materialize).toThrow(InterpolationUnresolvableError);
  });
});
