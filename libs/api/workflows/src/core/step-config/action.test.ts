import type {WorkflowModelAction} from '@shipfox/api-definitions-dto';
import type {Step} from '#core/entities/step.js';
import {ActionInputInvalidError} from '#core/errors.js';
import {workflowModel} from '#test/index.js';
import {completeStepDispatchConfig} from './complete-step-dispatch-config.js';
import {materializeJobExecutionSteps} from './materialize-job-execution-steps.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

function template(source: string): string {
  return '$'.concat('{{ ', source, ' }}');
}

const DIGEST = `sha256:${'a'.repeat(64)}`;

const creationContext: WorkflowEvaluationContext = {
  site: 'execution-creation',
  values: {event: {channel: 'C0123'}},
};

function dispatchContext(outputs: Record<string, unknown>): WorkflowEvaluationContext {
  return {site: 'step-dispatch', values: {steps: {build: {outputs}}}};
}

async function materializeActionStep(step: ActionStepInput) {
  const model = workflowModel({
    env: {REGION: 'eu'},
    jobs: {investigate: {steps: [step]}},
  });
  const job = model.jobs[0];
  if (!job) throw new Error('Expected workflow job');
  const steps = await materializeJobExecutionSteps({model, job, context: creationContext});
  const materialized = steps[1];
  if (!materialized) throw new Error('Expected materialized action step');
  return materialized;
}

interface ActionStepInput {
  readonly key?: string;
  readonly uses: string;
  readonly with?: Record<string, string | number>;
  readonly env?: Record<string, string>;
  readonly workingDirectory?: string;
  readonly action?: Partial<Omit<WorkflowModelAction, 'uses'>>;
}

function slackThreadStep(withValue: Record<string, string | number>): ActionStepInput {
  return {
    key: 'thread',
    uses: './.shipfox/actions/slack-thread',
    workingDirectory: 'app',
    env: {LOG_LEVEL: 'debug'},
    with: withValue,
    action: {
      digest: DIGEST,
      name: 'Slack thread to Markdown',
      inputs: {
        channel_id: {type: 'string', required: true},
        thread_ts: {type: 'string', required: true},
        limit: {type: 'number', required: false, default: 200},
      },
      integrations: {
        slack: {
          provider: 'slack',
          connection: 'team-slack',
          include: ['read_thread'],
          allowWrite: false,
        },
      },
    },
  };
}

function stepFrom(materialized: Awaited<ReturnType<typeof materializeActionStep>>): Step {
  return {
    id: 'step-1',
    jobExecutionId: 'exec-1',
    key: materialized.key,
    name: materialized.name,
    sourceLocation: null,
    status: 'pending',
    statusReason: null,
    evaluationTrace: null,
    type: 'action',
    config: {...materialized.config},
    condition: null,
    configPlan: materialized.configPlan ?? null,
    authoredConfig: materialized.authoredConfig,
    error: null,
    position: materialized.position,
    version: 1,
    currentAttempt: 1,
    createdAt: new Date('2026-06-30T12:00:00.000Z'),
    updatedAt: new Date('2026-06-30T12:00:00.000Z'),
  };
}

describe('action step config', () => {
  test('materializes the action, known inputs, env, bindings, and outputs', async () => {
    const materialized = await materializeActionStep(
      slackThreadStep({
        channel_id: template('event.channel'),
        thread_ts: template('steps.build.outputs.ts'),
      }),
    );

    expect(materialized).toMatchObject({
      key: 'thread',
      name: 'Slack thread to Markdown',
      type: 'action',
      config: {
        working_directory: 'app',
        action: {
          uses: './.shipfox/actions/slack-thread',
          digest: DIGEST,
          main: 'index.ts',
          name: 'Slack thread to Markdown',
        },
        inputs: {channel_id: 'C0123'},
        env: {REGION: 'eu', LOG_LEVEL: 'debug'},
        integrations: [{alias: 'slack', provider: 'slack', connection_slug: 'team-slack'}],
        outputs: {},
      },
      configPlan: {
        action: {
          inputs: {
            channel_id: {type: 'string', required: true},
            thread_ts: {type: 'string', required: true},
            limit: {type: 'number', required: false, default: 200},
          },
          with: {thread_ts: [{kind: 'deferred'}]},
        },
      },
      authoredConfig: {
        inputs: {
          channel_id: template('event.channel'),
          thread_ts: template('steps.build.outputs.ts'),
        },
      },
    });
    expect(Object.keys(materialized.config).sort()).toEqual([
      'action',
      'env',
      'inputs',
      'integrations',
      'outputs',
      'working_directory',
    ]);
  });

  test('keeps a declarations-only plan for a step with literal inputs', async () => {
    const materialized = await materializeActionStep(
      slackThreadStep({channel_id: 'C1', thread_ts: '1.0'}),
    );

    expect(materialized.config.inputs).toEqual({channel_id: 'C1', thread_ts: '1.0'});
    expect(materialized.configPlan).toEqual({
      action: {
        inputs: {
          channel_id: {type: 'string', required: true},
          thread_ts: {type: 'string', required: true},
          limit: {type: 'number', required: false, default: 200},
        },
      },
    });
  });

  test('fills dispatch-time inputs, applies defaults, and coerces declared types', async () => {
    const materialized = await materializeActionStep(
      slackThreadStep({
        channel_id: template('event.channel'),
        thread_ts: template('steps.build.outputs.ts'),
        limit: template('steps.build.outputs.limit'),
      }),
    );

    const completed = await completeStepDispatchConfig({
      step: stepFrom(materialized),
      context: dispatchContext({ts: '1727000000.1234', limit: '50'}),
      definitionId: 'definition-1',
    });

    expect(completed.config.inputs).toEqual({
      channel_id: 'C0123',
      thread_ts: '1727000000.1234',
      limit: 50,
    });
  });

  test('applies a default only when the input is omitted', async () => {
    const materialized = await materializeActionStep(
      slackThreadStep({channel_id: 'C1', thread_ts: '1.0'}),
    );

    const completed = await completeStepDispatchConfig({
      step: stepFrom(materialized),
      context: dispatchContext({}),
      definitionId: 'definition-1',
    });

    expect(completed.config.inputs).toEqual({channel_id: 'C1', thread_ts: '1.0', limit: 200});
  });

  test('rejects a dispatch-time value that does not match the declared type', async () => {
    const materialized = await materializeActionStep(
      slackThreadStep({
        channel_id: 'C1',
        thread_ts: '1.0',
        limit: template('steps.build.outputs.limit'),
      }),
    );

    const completion = completeStepDispatchConfig({
      step: stepFrom(materialized),
      context: dispatchContext({limit: 'many'}),
      definitionId: 'definition-1',
    });

    await expect(completion).rejects.toBeInstanceOf(ActionInputInvalidError);
    await expect(completion).rejects.toMatchObject({
      message: 'Action input "limit" must be a number value.',
      input: 'limit',
    });
  });
});
