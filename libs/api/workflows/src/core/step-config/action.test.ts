import type {WorkflowModelAction} from '@shipfox/api-definitions-dto';
import type {AgentToolMaterializationContext} from '#core/agent-tools.js';
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

const agentToolContext: AgentToolMaterializationContext = {
  catalogs: new Map([
    [
      'slack',
      [
        {
          id: 'read_thread',
          description: 'Read a thread.',
          sensitivity: 'read',
          sensitive: false,
          requiredScope: ['channels:history'],
          result: 'json',
          inputSchema: {type: 'object', properties: {channel: {type: 'string'}}},
        },
      ],
    ],
  ]),
  workspaceConnectionSnapshot: new Map([
    ['team-slack', {id: 'connection-slack', provider: 'slack', capabilities: ['agent_tools']}],
  ]),
  defaultConnection: {id: 'connection-slack', slug: 'team-slack', provider: 'slack'},
};

async function materializeActionStep(step: ActionStepInput) {
  const model = workflowModel({
    env: {REGION: 'eu'},
    jobs: {investigate: {steps: [step]}},
  });
  const job = model.jobs[0];
  if (!job) throw new Error('Expected workflow job');
  const steps = await materializeJobExecutionSteps({
    model,
    job,
    context: creationContext,
    agentToolContext,
  });
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
  test('marks an action from a model that predates origins as local', async () => {
    const step = slackThreadStep({channel_id: 'C1', thread_ts: '1.0'});

    const materialized = await materializeActionStep(step);

    expect(materialized.config.action).toEqual({
      uses: './.shipfox/actions/slack-thread',
      origin: 'local',
      digest: DIGEST,
      main: 'index.ts',
      name: 'Slack thread to Markdown',
    });
  });

  test('carries the package and version of a registry action', async () => {
    const step = slackThreadStep({channel_id: 'C1', thread_ts: '1.0'});

    const materialized = await materializeActionStep({
      ...step,
      uses: 'shipfox/slack-thread@1.4.2',
      action: {
        ...step.action,
        origin: 'registry',
        package: 'shipfox/slack-thread',
        version: '1.4.2',
      },
    });

    expect(materialized.config.action).toEqual({
      uses: 'shipfox/slack-thread@1.4.2',
      origin: 'registry',
      package: 'shipfox/slack-thread',
      version: '1.4.2',
      digest: DIGEST,
      main: 'index.ts',
      name: 'Slack thread to Markdown',
    });
  });

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
        job_key: 'investigate',
        inputs: {channel_id: 'C0123'},
        env: {REGION: 'eu', LOG_LEVEL: 'debug'},
        integrations: [
          {
            alias: 'slack',
            provider: 'slack',
            connection_slug: 'team-slack',
            tools: [
              {
                id: 'read_thread',
                sensitivity: 'read',
                sensitive: false,
                result: 'json',
                input_schema: {type: 'object', properties: {channel: {type: 'string'}}},
              },
            ],
          },
        ],
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
      'job_key',
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

  describe('secret inputs', () => {
    function npmStep(params: {tokenType: 'string' | 'number'}): ActionStepInput {
      const base = slackThreadStep({
        channel_id: 'C1',
        thread_ts: '1.0',
        token: template('secrets.NPM_TOKEN'),
      });
      return {
        ...base,
        env: {LOG_LEVEL: 'debug', SLACK_TOKEN: template('secrets.SLACK')},
        action: {
          ...base.action,
          inputs: {
            ...base.action?.inputs,
            token: {type: params.tokenType, required: true},
          },
        },
      };
    }

    test('binds a secret input by reference and keeps the value out of the config and trace', async () => {
      const materialized = await materializeActionStep(npmStep({tokenType: 'string'}));

      const completed = await completeStepDispatchConfig({
        step: stepFrom(materialized),
        context: dispatchContext({}),
        definitionId: 'definition-1',
      });

      expect(materialized.config.inputs).toEqual({channel_id: 'C1', thread_ts: '1.0'});
      expect(completed.config.inputs).toEqual({channel_id: 'C1', thread_ts: '1.0', limit: 200});
      expect(completed.config.secret_bindings).toEqual([
        {target: 'SLACK_TOKEN', segments: [{kind: 'secret', store: 'local', key: 'SLACK'}]},
        {
          target: {kind: 'input', name: 'token'},
          segments: [{kind: 'secret', store: 'local', key: 'NPM_TOKEN'}],
        },
      ]);
      const secretTrace = completed.trace.filter(
        (entry) => 'roots' in entry && entry.roots.includes('secrets'),
      );
      expect(secretTrace).toEqual([
        expect.objectContaining({field: 'env', envKey: 'SLACK_TOKEN', reference: true}),
        expect.objectContaining({
          field: 'action.with',
          expression: 'secrets.NPM_TOKEN',
          reference: true,
        }),
      ]);
      expect(secretTrace.every((entry) => !('value' in entry))).toBe(true);
    });

    test('rejects a secret bound to an input that is not a string', async () => {
      const materialized = await materializeActionStep(npmStep({tokenType: 'number'}));

      const completion = completeStepDispatchConfig({
        step: stepFrom(materialized),
        context: dispatchContext({}),
        definitionId: 'definition-1',
      });

      await expect(completion).rejects.toMatchObject({
        name: 'ActionInputInvalidError',
        message: 'Action input "token" receives a secret, so it must be a string input.',
        input: 'token',
      });
    });
  });
});
