import {createWorkflowModelSnapshot, type WorkflowModel} from '@shipfox/api-definitions-dto';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import {type RunIssue, workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {createInMemoryInterModuleTransport} from '@shipfox/node-module/inter-module';
import {eq} from 'drizzle-orm';
import {InterpolationUnresolvableError} from '#core/errors.js';
import {collectRunRequirements} from '#core/run-requirements.js';
import {db} from '#db/db.js';
import {deliverEventToListener} from '#db/job-listener-events.js';
import {drainListenerEventsIntoExecution} from '#db/job-listeners.js';
import {jobs} from '#db/schema/jobs.js';
import {createWorkflowRun, getJobsByWorkflowRunId} from '#db/workflow-runs.js';
import {createTestSecretsClient} from '#test/fixtures/secrets-inter-module.js';
import {expression, template} from '#test/helpers/workflow-runs.js';
import {workflowModel} from '#test/index.js';
import {createWorkflowsInterModulePresentation} from './inter-module.js';

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

    expect(definitions).toEqual([{definitionId, issues: expect.any(Array)}]);
    expect(
      definitions[0]?.issues.map((issue) => ({
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
    agent: {} as never,
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
  });

  if (result.kind !== 'execution') throw new Error(`Expected an execution, got ${result.kind}`);
  return result.status;
}
