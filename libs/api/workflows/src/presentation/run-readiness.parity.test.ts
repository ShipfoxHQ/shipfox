import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {agentInterModuleContract} from '@shipfox/api-agent-dto/inter-module';
import {createWorkflowModelSnapshot, type WorkflowModel} from '@shipfox/api-definitions-dto';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import {type RunIssue, workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {closeApp, createApp, type FastifyInstance} from '@shipfox/node-fastify';
import {createInMemoryInterModuleTransport} from '@shipfox/node-module/inter-module';
import {eq} from 'drizzle-orm';
import {createAgentDefaultsResolver} from '#core/agent-defaults.js';
import {AgentConfigUnresolvableError, InterpolationUnresolvableError} from '#core/errors.js';
import {collectRunRequirements} from '#core/run-requirements.js';
import {completeStepDispatchConfig} from '#core/step-config/index.js';
import {db} from '#db/db.js';
import {deliverEventToListener} from '#db/job-listener-events.js';
import {drainListenerEventsIntoExecution} from '#db/job-listeners.js';
import {jobs} from '#db/schema/jobs.js';
import {steps as stepsTable} from '#db/schema/steps.js';
import {createWorkflowRun, getJobsByWorkflowRunId, getStepsByJobId} from '#db/workflow-runs.js';
import {mintActiveLeaseToken} from '#test/fixtures/active-lease-token.js';
import {agentTestClient, resolveTestAgentDefaults} from '#test/fixtures/agent-inter-module.js';
import {annotationsTestClient} from '#test/fixtures/annotations-inter-module.js';
import {workflowsTestAuthClient} from '#test/fixtures/auth-inter-module.js';
import {fakeLeaseTokenAuthMethod} from '#test/fixtures/lease-token.js';
import {projectsTestClient} from '#test/fixtures/projects-inter-module.js';
import {runnersTestClient} from '#test/fixtures/runners-inter-module.js';
import {createTestSecretsClient} from '#test/fixtures/secrets-inter-module.js';
import {expression, template} from '#test/helpers/workflow-runs.js';
import {workflowModel} from '#test/index.js';
import {createWorkflowsInterModulePresentation} from './inter-module.js';
import {createLeaseTokenRouteGroup} from './routes/index.js';

interface ParityFixture {
  readonly name: string;
  readonly model: () => WorkflowModel;
  readonly workspaceVariables?: readonly string[];
  readonly projectVariables?: readonly string[];
  /** Defined in a sibling project, which this project's runs never see. */
  readonly siblingProjectVariables?: readonly string[];
  readonly issues: readonly {
    readonly key: string;
    readonly effect: RunIssue['effect'];
    readonly fields: readonly string[];
  }[];
}

const listeningOn = (filter?: string) => ({
  on: [{source: 'github', event: 'pull_request', ...(filter === undefined ? {} : {filter})}],
  until: [{source: 'github', event: 'push'}],
  onResolve: 'finish' as const,
});

const FIXTURES: readonly ParityFixture[] = [
  {
    name: 'a missing variable in job.if',
    model: () =>
      workflowModel({
        jobs: {build: {if: 'vars.DEPLOY == "true"', steps: [{run: 'echo build'}]}},
      }),
    issues: [{key: 'DEPLOY', effect: 'blocks-start', fields: ['job.if']}],
  },
  {
    name: 'a has()-wrapped reference, which stays required',
    model: () =>
      workflowModel({
        jobs: {
          build: {if: 'has(vars.OPTIONAL) ? vars.OPTIONAL == "true" : false', steps: [{run: 'x'}]},
        },
      }),
    issues: [{key: 'OPTIONAL', effect: 'blocks-start', fields: ['job.if']}],
  },
  {
    name: 'a missing variable in a listening on filter',
    model: () =>
      workflowModel({
        jobs: {
          watch: {
            listening: listeningOn('vars.TEAM == "core"'),
            steps: [{run: 'echo watch'}],
          },
        },
      }),
    issues: [{key: 'TEAM', effect: 'blocks-start', fields: ['job.listening.filter']}],
  },
  {
    name: "a missing variable in a listening step's env",
    model: () =>
      workflowModel({
        jobs: {
          watch: {
            listening: listeningOn(),
            steps: [{run: 'echo watch', env: {REGION: template('vars.REGION')}}],
          },
        },
      }),
    issues: [{key: 'REGION', effect: 'fails-job', fields: ['env']}],
  },
  {
    name: 'a missing variable in a listening step predicate',
    model: () =>
      workflowModel({
        jobs: {
          watch: {
            listening: listeningOn(),
            steps: [{if: expression('vars.ENABLED == "true"'), run: 'echo watch'}],
          },
        },
      }),
    issues: [{key: 'ENABLED', effect: 'blocks-start', fields: ['step.if']}],
  },
  {
    name: 'the same key missing in both phases',
    model: () =>
      workflowModel({
        jobs: {
          watch: {
            listening: listeningOn('vars.SHARED == "on"'),
            steps: [{run: 'echo watch', env: {SHARED: template('vars.SHARED')}}],
          },
        },
      }),
    issues: [
      {key: 'SHARED', effect: 'blocks-start', fields: ['job.listening.filter']},
      {key: 'SHARED', effect: 'fails-job', fields: ['env']},
    ],
  },
  {
    name: 'a variable defined at workspace scope',
    model: () =>
      workflowModel({
        jobs: {build: {if: 'vars.DEPLOY == "true"', steps: [{run: 'echo build'}]}},
      }),
    workspaceVariables: ['DEPLOY'],
    issues: [],
  },
  {
    name: 'a variable defined at project scope only',
    model: () =>
      workflowModel({
        jobs: {
          watch: {
            listening: listeningOn('vars.TEAM == "core"'),
            steps: [{run: 'echo watch', env: {REGION: template('vars.REGION')}}],
          },
        },
      }),
    projectVariables: ['TEAM', 'REGION'],
    issues: [],
  },
  {
    name: 'a variable defined at both scopes',
    model: () =>
      workflowModel({
        jobs: {build: {if: 'vars.DEPLOY == "true"', steps: [{run: 'echo build'}]}},
      }),
    workspaceVariables: ['DEPLOY'],
    projectVariables: ['DEPLOY'],
    issues: [],
  },
  {
    name: 'a variable that only a sibling project defines',
    model: () =>
      workflowModel({
        jobs: {build: {if: 'vars.DEPLOY == "true"', steps: [{run: 'echo build'}]}},
      }),
    siblingProjectVariables: ['DEPLOY'],
    issues: [{key: 'DEPLOY', effect: 'blocks-start', fields: ['job.if']}],
  },
  {
    name: 'a missing variable in the run name, which run creation skips',
    model: () =>
      workflowModel({
        runName: template('vars.LABEL'),
        jobs: {build: {steps: [{run: 'echo build'}]}},
      }),
    issues: [],
  },
  {
    name: 'a missing variable in a listening execution name, which execution creation skips',
    model: () =>
      workflowModel({
        jobs: {
          watch: {
            executionName: `Review ${template('vars.LABEL')}`,
            listening: listeningOn(),
            steps: [{run: 'echo watch'}],
          },
        },
      }),
    issues: [],
  },
];

describe('run readiness parity with run creation and execution creation', () => {
  it.each(FIXTURES)('$name', async (fixture) => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const definitionId = crypto.randomUUID();
    const model = fixture.model();
    const secrets = createTestSecretsClient();
    await secrets.setSecrets({
      workspaceId,
      values: variableValues(fixture.workspaceVariables),
    });
    await secrets.setSecrets({
      workspaceId,
      projectId,
      values: variableValues(fixture.projectVariables),
    });
    await secrets.setSecrets({
      workspaceId,
      projectId: crypto.randomUUID(),
      values: variableValues(fixture.siblingProjectVariables),
    });
    // The sibling project defines its variables under a project id the run never sees.
    const client = readinessClient({workspaceId, projectId, definitionId, model, secrets});
    const expectBlocked = fixture.issues.some((issue) => issue.effect === 'blocks-start');
    const expectFailedExecution = fixture.issues.some((issue) => issue.effect === 'fails-job');

    const {definitions} = await client.checkRunReadiness({
      workspaceId,
      projectId,
      definitionIds: [definitionId],
    });
    const startError = await startRun({
      workspaceId,
      projectId,
      definitionId,
      model,
      secrets,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(definitions).toEqual([
      {definitionId, issues: expect.any(Array), secretInputs: expect.any(Array)},
    ]);
    expect(
      definitions[0]?.issues.map(keyedIssue).map((issue) => ({
        key: issue.key,
        effect: issue.effect,
        fields: issue.locations.map((location) => location.field),
      })),
    ).toEqual(fixture.issues);
    if (expectBlocked) {
      expect(startError).toBeInstanceOf(InterpolationUnresolvableError);
      expect((startError as InterpolationUnresolvableError).variableKey).toBe(
        fixture.issues.find((issue) => issue.effect === 'blocks-start')?.key,
      );
    } else {
      expect(startError).toBeUndefined();
    }
    // A refused start never reaches execution creation, so only a fixture that has a
    // `fails-job` issue, or no issue that refuses the start, says what the execution does.
    if (hasListeningJob(model) && (!expectBlocked || expectFailedExecution)) {
      const status = await listenerExecutionStatus({
        workspaceId,
        projectId,
        model,
        secrets,
      });
      expect(status).toBe(expectFailedExecution ? 'failed' : 'pending');
    }
  });
});

interface SecretParityFixture {
  readonly name: string;
  readonly model: () => WorkflowModel;
  readonly workspaceSecrets?: readonly string[];
  readonly projectSecrets?: readonly string[];
  /** Defined in a sibling project, which this project's runs never see. */
  readonly siblingProjectSecrets?: readonly string[];
  readonly issues: readonly {readonly key: string; readonly fields: readonly string[]}[];
  readonly secretInputs: readonly string[];
  /** What the runner's step-secrets pull returns for the run step once the run has started. */
  readonly pull:
    | {readonly status: 200; readonly secrets: readonly string[]}
    | {readonly status: 422; readonly code: string; readonly key: string};
}

const SECRET_FIXTURES: readonly SecretParityFixture[] = [
  {
    name: 'a missing secret in a step env',
    model: () =>
      workflowModel({
        jobs: {build: {steps: [{run: 'echo build', env: {TOKEN: template('secrets.API_TOKEN')}}]}},
      }),
    issues: [{key: 'API_TOKEN', fields: ['env']}],
    secretInputs: [],
    pull: {status: 422, code: 'secret-not-found', key: 'API_TOKEN'},
  },
  {
    name: 'a missing secret in a run command',
    model: () =>
      workflowModel({
        jobs: {build: {steps: [{run: `deploy --token ${template('secrets.local.API_TOKEN')}`}]}},
      }),
    issues: [{key: 'API_TOKEN', fields: ['run']}],
    secretInputs: [],
    pull: {status: 422, code: 'secret-not-found', key: 'API_TOKEN'},
  },
  {
    name: 'a secret defined at workspace scope',
    model: () =>
      workflowModel({
        jobs: {build: {steps: [{run: 'echo build', env: {TOKEN: template('secrets.API_TOKEN')}}]}},
      }),
    workspaceSecrets: ['API_TOKEN'],
    issues: [],
    secretInputs: [],
    pull: {status: 200, secrets: ['API_TOKEN']},
  },
  {
    name: 'a secret defined at project scope',
    model: () =>
      workflowModel({
        jobs: {build: {steps: [{run: 'echo build', env: {TOKEN: template('secrets.API_TOKEN')}}]}},
      }),
    projectSecrets: ['API_TOKEN'],
    issues: [],
    secretInputs: [],
    pull: {status: 200, secrets: ['API_TOKEN']},
  },
  {
    name: 'a secret that only a sibling project defines',
    model: () =>
      workflowModel({
        jobs: {build: {steps: [{run: 'echo build', env: {TOKEN: template('secrets.API_TOKEN')}}]}},
      }),
    siblingProjectSecrets: ['API_TOKEN'],
    issues: [{key: 'API_TOKEN', fields: ['env']}],
    secretInputs: [],
    pull: {status: 422, code: 'secret-not-found', key: 'API_TOKEN'},
  },
  {
    name: 'a secret input, which a trigger supplies and readiness leaves to it',
    model: () =>
      workflowModel({
        jobs: {
          build: {
            steps: [{run: 'echo build', env: {TOKEN: template('secrets.inputs.DEPLOY_TOKEN')}}],
          },
        },
      }),
    issues: [],
    secretInputs: ['DEPLOY_TOKEN'],
    pull: {status: 422, code: 'secret-input-missing', key: 'DEPLOY_TOKEN'},
  },
];

describe('step secret readiness parity with run creation and the step-secrets pull', () => {
  let app: FastifyInstance;
  const pullSecrets = createTestSecretsClient();

  beforeAll(async () => {
    app = await createApp({
      auth: [fakeLeaseTokenAuthMethod],
      routes: [
        createLeaseTokenRouteGroup({
          agent: agentTestClient,
          annotations: annotationsTestClient,
          auth: workflowsTestAuthClient,
          definitions: {} as never,
          integrations: {} as never,
          projects: projectsTestClient,
          runners: runnersTestClient,
          secrets: pullSecrets,
        }),
      ],
      swagger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await closeApp();
  });

  it.each(SECRET_FIXTURES)('$name', async (fixture) => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const definitionId = crypto.randomUUID();
    const model = fixture.model();
    const secrets = createTestSecretsClient();
    for (const [scope, names] of [
      [{}, fixture.workspaceSecrets],
      [{projectId}, fixture.projectSecrets],
      [{projectId: crypto.randomUUID()}, fixture.siblingProjectSecrets],
    ] as const) {
      await secrets.setSecrets({workspaceId, ...scope, values: variableValues(names)});
      await pullSecrets.setSecrets({workspaceId, ...scope, values: variableValues(names)});
    }
    const client = readinessClient({workspaceId, projectId, definitionId, model, secrets});

    const {definitions} = await client.checkRunReadiness({
      workspaceId,
      projectId,
      definitionIds: [definitionId],
    });
    const run = await startRun({workspaceId, projectId, definitionId, model, secrets});
    const pull = await pullRunStepSecrets(app, run.id);

    // A missing step secret never refuses the start: the job fails when the step pulls it.
    expect(
      definitions[0]?.issues.map(keyedIssue).map((issue) => ({
        kind: issue.kind,
        effect: issue.effect,
        key: issue.key,
        fields: issue.locations.map((location) => location.field),
      })),
    ).toEqual(
      fixture.issues.map((issue) => ({
        kind: 'secret-missing',
        effect: 'fails-job',
        ...issue,
      })),
    );
    expect(definitions[0]?.secretInputs.map((input) => input.key)).toEqual(fixture.secretInputs);
    expect(pull.statusCode).toBe(fixture.pull.status);
    if (fixture.pull.status === 200) {
      // An empty response would also be a 200, so check the bindings resolved.
      expect(pull.json().secrets.map((secret: {key: string}) => secret.key)).toEqual(
        fixture.pull.secrets,
      );
    }
    if (fixture.pull.status === 422) {
      expect(pull.json()).toMatchObject({
        code: fixture.pull.code,
        details: {key: fixture.pull.key},
      });
    }
  });
});

async function pullRunStepSecrets(app: FastifyInstance, runId: string) {
  const [job] = await getJobsByWorkflowRunId(runId);
  if (!job) throw new Error('Expected the run to create a job');
  await db().update(jobs).set({status: 'running'}).where(eq(jobs.id, job.id));
  const step = (await getStepsByJobId(job.id)).find((candidate) => candidate.type === 'run');
  if (!step) throw new Error('Expected the job to create a run step');
  // Dispatch turns the planned secret references into the bindings the pull resolves.
  const completed = await completeStepDispatchConfig({
    step,
    context: {site: 'step-dispatch', values: {}},
    definitionId: job.id,
  });
  await db()
    .update(stepsTable)
    .set({status: 'running', config: completed.config})
    .where(eq(stepsTable.id, step.id));
  const token = await mintActiveLeaseToken({renewableInference: false, jobId: job.id});

  return await app.inject({
    method: 'GET',
    url: `/runs/jobs/current/steps/${step.id}/secrets?attempt=${step.currentAttempt}`,
    headers: {authorization: `Bearer ${token}`},
  });
}

interface AgentParityFixture {
  readonly name: string;
  readonly model: () => WorkflowModel;
  /** The workspace's default model is one the agent module refuses. */
  readonly invalidWorkspaceDefaults?: boolean;
  readonly issues: readonly {
    readonly reason: 'model-unknown' | 'provider-unsupported';
    readonly model?: string;
    readonly provider?: string;
    readonly effect: RunIssue['effect'];
    readonly fields: readonly string[];
  }[];
}

const INVALID_MODEL = 'not-a-model';
const RETIRED_DEFAULT_MODEL = 'retired-default';

const agentJob = (step: Record<string, unknown>, job: Record<string, unknown> = {}) => ({
  ...job,
  steps: [{prompt: 'Review it.', ...step}],
});

const AGENT_FIXTURES: readonly AgentParityFixture[] = [
  {
    name: 'a literal invalid model in a normal job',
    model: () => workflowModel({jobs: {review: agentJob({model: INVALID_MODEL})}}),
    issues: [
      {
        reason: 'model-unknown',
        model: INVALID_MODEL,
        provider: 'anthropic',
        effect: 'blocks-start',
        fields: ['agent.model'],
      },
    ],
  },
  {
    name: 'a literal invalid model in a listening job',
    model: () =>
      workflowModel({
        jobs: {review: agentJob({model: INVALID_MODEL}, {listening: listeningOn()})},
      }),
    issues: [
      {
        reason: 'model-unknown',
        model: INVALID_MODEL,
        provider: 'anthropic',
        effect: 'fails-job',
        fields: ['agent.model'],
      },
    ],
  },
  {
    name: 'a literal invalid model with a session key from a deferred root',
    model: () =>
      workflowModel({
        jobs: {
          review: agentJob({
            model: INVALID_MODEL,
            session: template('steps.build.outputs.sha'),
          }),
        },
      }),
    issues: [
      {
        reason: 'model-unknown',
        model: INVALID_MODEL,
        provider: 'anthropic',
        effect: 'fails-job',
        fields: ['agent.model'],
      },
    ],
  },
  {
    name: 'a literal invalid model with a session key that run creation fills',
    model: () =>
      workflowModel({
        jobs: {
          review: agentJob({model: INVALID_MODEL, session: template('run.name')}),
        },
      }),
    issues: [
      {
        reason: 'model-unknown',
        model: INVALID_MODEL,
        provider: 'anthropic',
        effect: 'blocks-start',
        fields: ['agent.model'],
      },
    ],
  },
  {
    name: 'a model from execution.events[0].data.model, which only an execution knows',
    model: () =>
      workflowModel({
        jobs: {review: agentJob({model: template('execution.events[0].data.model')})},
      }),
    issues: [],
  },
  {
    name: 'a model and a provider that run creation fills from the trigger and the run name',
    model: () =>
      workflowModel({
        jobs: {
          review: agentJob({
            model: template('run.name'),
            provider: template('trigger.source'),
          }),
        },
      }),
    issues: [],
  },
  {
    name: 'an invalid literal provider next to a templated model',
    model: () =>
      workflowModel({
        jobs: {
          review: agentJob({
            provider: 'not-a-provider',
            model: template('execution.events[0].data.model'),
          }),
        },
      }),
    issues: [],
  },
  {
    name: 'an invalid literal provider',
    model: () => workflowModel({jobs: {review: agentJob({provider: 'not-a-provider'})}}),
    issues: [
      {
        reason: 'provider-unsupported',
        provider: 'not-a-provider',
        effect: 'blocks-start',
        fields: ['agent.provider'],
      },
    ],
  },
  {
    name: 'invalid workspace defaults in a normal job',
    model: () => workflowModel({jobs: {review: agentJob({})}}),
    invalidWorkspaceDefaults: true,
    issues: [
      {
        reason: 'model-unknown',
        model: RETIRED_DEFAULT_MODEL,
        provider: 'anthropic',
        effect: 'blocks-start',
        fields: ['agent.model'],
      },
    ],
  },
  {
    name: 'invalid workspace defaults in a listening job',
    model: () => workflowModel({jobs: {review: agentJob({}, {listening: listeningOn()})}}),
    invalidWorkspaceDefaults: true,
    issues: [
      {
        reason: 'model-unknown',
        model: RETIRED_DEFAULT_MODEL,
        provider: 'anthropic',
        effect: 'fails-job',
        fields: ['agent.model'],
      },
    ],
  },
  {
    name: 'invalid workspace defaults that a literal model overrides',
    model: () => workflowModel({jobs: {review: agentJob({model: 'claude-opus-4-8'})}}),
    invalidWorkspaceDefaults: true,
    issues: [],
  },
  {
    name: 'a valid configuration',
    model: () => workflowModel({jobs: {review: agentJob({model: 'claude-opus-4-8'})}}),
    issues: [],
  },
];

describe('agent configuration readiness parity with run creation, execution creation and dispatch', () => {
  it.each(AGENT_FIXTURES)('$name', async (fixture) => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const definitionId = crypto.randomUUID();
    const model = fixture.model();
    const secrets = createTestSecretsClient();
    const agent = agentClient({
      invalidDefaultsWorkspaceId: fixture.invalidWorkspaceDefaults ? workspaceId : undefined,
    });
    const client = readinessClient({workspaceId, projectId, definitionId, model, secrets, agent});
    const expectBlocked = fixture.issues.some((issue) => issue.effect === 'blocks-start');
    const expectFailedLater = fixture.issues.some((issue) => issue.effect === 'fails-job');

    const {definitions} = await client.checkRunReadiness({
      workspaceId,
      projectId,
      definitionIds: [definitionId],
    });
    const started = await startRun({
      workspaceId,
      projectId,
      definitionId,
      model,
      secrets,
      agent,
    }).then(
      (run) => ({run}),
      (error: unknown) => ({error}),
    );

    expect(
      definitions[0]?.issues.map((issue) => {
        if (issue.kind !== 'agent-config-invalid') throw new Error(`Unexpected ${issue.kind}`);
        return {
          reason: issue.reason,
          ...(issue.model === undefined ? {} : {model: issue.model}),
          ...(issue.provider === undefined ? {} : {provider: issue.provider}),
          effect: issue.effect,
          fields: issue.locations.map((location) => location.field),
        };
      }),
    ).toEqual(fixture.issues);
    if (expectBlocked) {
      expect('error' in started && started.error).toBeInstanceOf(AgentConfigUnresolvableError);
      expect(refusal(started)).toMatchObject({
        reason: fixture.issues[0]?.reason,
        model: fixture.issues[0]?.model,
      });
      return;
    }
    expect('error' in started).toBe(false);
    if (!hasListeningJob(model) && !expectFailedLater) return;

    // The run started, so the issue is for a job that fails after it has.
    if (hasListeningJob(model)) {
      const status = await listenerExecutionStatus({
        workspaceId,
        projectId,
        model,
        secrets,
        agent,
      });
      expect(status).toBe(expectFailedLater ? 'failed' : 'pending');
      return;
    }
    if (!('run' in started)) throw new Error('Expected the run to start');
    await expect(
      dispatchAgentStep({runId: started.run.id, agent, workspaceId}),
    ).rejects.toBeInstanceOf(AgentConfigUnresolvableError);
  });
});

/**
 * An agent module that refuses one model and one provider, and, for one workspace, refuses
 * the default model it would otherwise pick.
 */
function agentClient(options: {
  invalidDefaultsWorkspaceId?: string | undefined;
}): AgentInterModuleClient {
  return {
    ...agentTestClient,
    resolveAgentConfig: async ({workspaceId, config}) => {
      const defaultModel =
        workspaceId !== null && workspaceId === options.invalidDefaultsWorkspaceId
          ? RETIRED_DEFAULT_MODEL
          : undefined;
      const model = config.model ?? defaultModel;
      const provider = config.provider ?? 'anthropic';
      if (config.provider === 'not-a-provider') {
        throw createInterModuleKnownError(
          agentInterModuleContract.methods.resolveAgentConfig,
          'agent-config-invalid',
          {reason: 'provider-unsupported', provider},
        );
      }
      if (model === INVALID_MODEL || model === RETIRED_DEFAULT_MODEL) {
        throw createInterModuleKnownError(
          agentInterModuleContract.methods.resolveAgentConfig,
          'agent-config-invalid',
          {reason: 'model-unknown', model, provider},
        );
      }
      return await resolveTestAgentDefaults(config);
    },
  };
}

function refusal(started: {run: unknown} | {error: unknown}): AgentConfigUnresolvableError {
  if (!('error' in started) || !(started.error instanceof AgentConfigUnresolvableError)) {
    throw new Error('Expected the start to be refused for its agent configuration');
  }
  return started.error;
}

/** Complete the run's agent step the way dispatch does, which resolves with no workspace. */
async function dispatchAgentStep(params: {
  runId: string;
  agent: AgentInterModuleClient;
  workspaceId: string;
}) {
  const [job] = await getJobsByWorkflowRunId(params.runId);
  if (!job) throw new Error('Expected the run to create a job');
  const step = (await getStepsByJobId(job.id)).find((candidate) => candidate.type === 'agent');
  if (!step) throw new Error('Expected the job to create an agent step');
  return await completeStepDispatchConfig({
    step,
    context: {site: 'step-dispatch', values: {}},
    resolveAgentDefaults: createAgentDefaultsResolver(params.agent, null),
    definitionId: job.id,
  });
}

describe('checkRunReadiness definitions', () => {
  it('leaves out ids that name no definition in the project', async () => {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const definitionId = crypto.randomUUID();
    const client = readinessClient({
      workspaceId,
      projectId,
      definitionId,
      model: workflowModel(),
      secrets: createTestSecretsClient(),
    });

    const {definitions} = await client.checkRunReadiness({
      workspaceId,
      projectId: crypto.randomUUID(),
      definitionIds: [definitionId, crypto.randomUUID()],
    });

    expect(definitions).toEqual([]);
  });
});

function keyedIssue(issue: RunIssue): Exclude<RunIssue, {kind: 'agent-config-invalid'}> {
  if (issue.kind === 'agent-config-invalid') throw new Error('Expected a variable or secret issue');
  return issue;
}

function variableValues(names: readonly string[] | undefined): Record<string, string> {
  return Object.fromEntries((names ?? []).map((name) => [name, 'on']));
}

function hasListeningJob(model: WorkflowModel): boolean {
  return model.jobs.some((job) => job.mode === 'listening');
}

function readinessClient(params: {
  workspaceId: string;
  projectId: string;
  definitionId: string;
  model: WorkflowModel;
  secrets: ReturnType<typeof createTestSecretsClient>;
  agent?: AgentInterModuleClient;
}) {
  const definitions = {
    getDefinitionForWorkflowRun: async ({definitionId}: {definitionId: string}) => ({
      definition:
        definitionId === params.definitionId
          ? {
              id: definitionId,
              workflowId: definitionId,
              projectId: params.projectId,
              name: params.model.name,
              model: createWorkflowModelSnapshot(params.model),
              sourceSnapshot: null,
            }
          : null,
    }),
  } as unknown as DefinitionsInterModuleClient;
  const presentation = createWorkflowsInterModulePresentation({
    agent: params.agent ?? ({} as never),
    definitions,
    integrations: {} as never,
    projects: {} as never,
    runners: {} as never,
    secrets: params.secrets,
    workspaces: {} as never,
  });
  const transport = createInMemoryInterModuleTransport();
  const client = transport.createClient(workflowsInterModuleContract);
  transport.register(presentation);
  transport.seal();
  return client;
}

function startRun(params: {
  workspaceId: string;
  projectId: string;
  definitionId: string;
  model: WorkflowModel;
  secrets: ReturnType<typeof createTestSecretsClient>;
  agent?: AgentInterModuleClient;
}) {
  return createWorkflowRun({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    definitionId: params.definitionId,
    model: params.model,
    triggerPayload: {
      source: 'manual',
      event: 'fire',
      subscriptionId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
    },
    secrets: params.secrets,
    ...(params.agent === undefined
      ? {}
      : {resolveAgentDefaults: createAgentDefaultsResolver(params.agent, params.workspaceId)}),
  });
}

/**
 * Fire the first listening job of a run that was created with every referenced variable
 * defined, so the run starts, then create its execution against the state under test.
 * That isolates the execution phase from a start that the same state would refuse.
 */
async function listenerExecutionStatus(params: {
  workspaceId: string;
  projectId: string;
  model: WorkflowModel;
  secrets: ReturnType<typeof createTestSecretsClient>;
  agent?: AgentInterModuleClient;
}): Promise<string> {
  const everything = createTestSecretsClient();
  await everything.setSecrets({
    workspaceId: params.workspaceId,
    values: variableValues(
      collectRunRequirements(params.model, params.model.jobs).variables.map(({key}) => key),
    ),
  });
  const run = await startRun({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    definitionId: crypto.randomUUID(),
    model: params.model,
    secrets: everything,
  });
  const listening = (await getJobsByWorkflowRunId(run.id)).find((job) => job.mode === 'listening');
  if (!listening) throw new Error('Expected the run to create a listening job');
  await db()
    .update(jobs)
    .set({status: 'running', listenerStatus: 'listening'})
    .where(eq(jobs.id, listening.id));
  await deliverEventToListener({
    jobId: listening.id,
    disposition: 'fire',
    eventRef: crypto.randomUUID(),
    deliveryId: crypto.randomUUID(),
    source: 'github',
    event: 'pull_request',
    provider: 'github',
    payload: {action: 'opened'},
    receivedAt: new Date('2026-01-01T00:00:00.000Z'),
  });

  const result = await drainListenerEventsIntoExecution({
    jobId: listening.id,
    expectedSequence: 1,
    secrets: params.secrets,
    ...(params.agent === undefined ? {} : {agent: params.agent}),
  });

  if (result.kind !== 'execution') throw new Error(`Expected an execution, got ${result.kind}`);
  return result.status;
}
