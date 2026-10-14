import type {AgentToolMaterializationContext} from '#core/agent-tools.js';
import type {Step} from '#core/entities/step.js';
import {AgentIntegrationMaterializationError} from '#core/errors.js';
import {resolveTestAgentDefaults} from '#test/fixtures/agent-inter-module.js';
import {type TestAgentMcpServer, workflowModel} from '#test/index.js';
import {completeStepDispatchConfig} from './complete-step-dispatch-config.js';
import {
  type MaterializedWorkflowStep,
  materializeJobExecutionSteps,
} from './materialize-job-execution-steps.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

function template(source: string): string {
  return `\${{ ${source} }}`;
}

function creationContext(values: Record<string, unknown> = {}): WorkflowEvaluationContext {
  return {
    site: 'execution-creation',
    values: {
      run: {id: 'run-1', name: 'Investigate', definition_id: 'def-1'},
      trigger: {source: 'manual', event: 'fire'},
      event: null,
      inputs: null,
      vars: {LEVEL: 'debug'},
      ...values,
    },
  };
}

function dispatchContext(values: Record<string, unknown> = {}): WorkflowEvaluationContext {
  return {site: 'step-dispatch', values: {...creationContext().values, ...values}};
}

async function agentStep(params: {
  mcpServers: Readonly<Record<string, TestAgentMcpServer>>;
  prompt?: string;
  integrations?: readonly {connection?: string; include: string[]}[];
  agentToolContext?: AgentToolMaterializationContext;
}): Promise<MaterializedWorkflowStep> {
  const model = workflowModel({
    jobs: {
      investigate: {
        steps: [
          {
            prompt: params.prompt ?? 'Find slow queries.',
            mcpServers: params.mcpServers,
            ...(params.integrations === undefined
              ? {}
              : {
                  integrations: params.integrations.map((integration) => ({
                    ...integration,
                    allowWrite: false,
                  })),
                }),
          },
        ],
      },
    },
  });
  const job = model.jobs[0];
  if (!job) throw new Error('Test model created no jobs');
  const steps = await materializeJobExecutionSteps({
    model,
    job,
    context: creationContext(),
    resolveAgentDefaults: resolveTestAgentDefaults,
    ...(params.agentToolContext === undefined ? {} : {agentToolContext: params.agentToolContext}),
  });
  const step = steps.find((candidate) => candidate.type === 'agent');
  if (!step) throw new Error('Expected an agent step');
  return step;
}

function pendingStep(step: MaterializedWorkflowStep): Step {
  return {
    id: 'step-1',
    jobExecutionId: 'exec-1',
    key: null,
    name: step.name,
    sourceLocation: null,
    status: 'pending',
    statusReason: null,
    evaluationTrace: null,
    type: 'agent',
    config: {...step.config},
    condition: null,
    runAfter: 'success',
    configPlan: step.configPlan ?? null,
    authoredConfig: null,
    error: null,
    position: 1,
    version: 1,
    currentAttempt: 1,
    createdAt: new Date('2026-06-30T12:00:00.000Z'),
    updatedAt: new Date('2026-06-30T12:00:00.000Z'),
  };
}

async function dispatch(step: MaterializedWorkflowStep, context = dispatchContext()) {
  return await completeStepDispatchConfig({
    step: pendingStep(step),
    context,
    resolveAgentDefaults: resolveTestAgentDefaults,
    definitionId: 'def-1',
  });
}

describe('agent step MCP servers', () => {
  it('freezes env values known at materialization and leaves dispatch nothing to fill', async () => {
    const step = await agentStep({
      mcpServers: {
        mongodb: {
          command: 'npx',
          args: ['-y', 'mongodb-mcp-server@1.2.0'],
          env: {MDB_MCP_READ_ONLY: 'true', LOG_LEVEL: template('vars.LEVEL')},
          include: ['find'],
        },
      },
    });

    expect(step.config.customMcpServers).toEqual([
      {
        name: 'mongodb',
        command: 'npx',
        args: ['-y', 'mongodb-mcp-server@1.2.0'],
        env: {MDB_MCP_READ_ONLY: 'true', LOG_LEVEL: 'debug'},
        include: ['find'],
      },
    ]);
    expect(step.configPlan?.agent).toBeUndefined();
  });

  it('turns a secret env value into an mcp_server_env binding at dispatch', async () => {
    const step = await agentStep({
      mcpServers: {
        mongodb: {
          command: 'npx',
          env: {
            MDB_MCP_CONNECTION_STRING: template('secrets.MONGO_URI'),
            MDB_MCP_READ_ONLY: 'true',
          },
        },
      },
    });

    const {config} = await dispatch(step);

    expect(step.configPlan?.agent?.customMcpServerEnv?.mongodb).toHaveProperty(
      'MDB_MCP_CONNECTION_STRING',
    );
    expect(config.customMcpServers).toEqual([
      {name: 'mongodb', command: 'npx', args: [], env: {MDB_MCP_READ_ONLY: 'true'}},
    ]);
    expect(config.secret_bindings).toEqual([
      {
        target: {kind: 'mcp_server_env', server: 'mongodb', name: 'MDB_MCP_CONNECTION_STRING'},
        segments: [{kind: 'secret', store: 'local', key: 'MONGO_URI'}],
      },
    ]);
    expect(JSON.stringify(config)).not.toContain('secrets.MONGO_URI');
  });

  it('fills an env value that reads a dispatch-time context', async () => {
    const step = await agentStep({
      mcpServers: {
        docs: {command: 'docs-mcp', env: {INDEX: template('steps.prep.outputs.index')}},
      },
    });

    const {config} = await dispatch(
      step,
      dispatchContext({steps: {prep: {outputs: {index: 'idx-7'}}}}),
    );

    expect(config.customMcpServers).toEqual([
      {name: 'docs', command: 'docs-mcp', args: [], env: {INDEX: 'idx-7'}},
    ]);
    expect(config).not.toHaveProperty('secret_bindings');
  });

  it('keeps the servers when the prompt is filled at dispatch', async () => {
    const step = await agentStep({
      prompt: `Look at ${template('steps.prep.outputs.collection')}.`,
      mcpServers: {mongodb: {command: 'npx', env: {URI: template('secrets.MONGO_URI')}}},
    });

    const {config} = await dispatch(
      step,
      dispatchContext({steps: {prep: {outputs: {collection: 'orders'}}}}),
    );

    expect(config.prompt).toBe('Look at orders.');
    expect(config.customMcpServers).toEqual([{name: 'mongodb', command: 'npx', args: [], env: {}}]);
    expect(config.secret_bindings).toEqual([
      expect.objectContaining({target: {kind: 'mcp_server_env', server: 'mongodb', name: 'URI'}}),
    ]);
  });

  it('rejects a server with the tool prefix of the default connection', async () => {
    const materialized = agentStep({
      integrations: [{include: ['issue_read']}],
      mcpServers: {github_main: {command: 'gh-mcp'}},
      agentToolContext: {
        catalogs: new Map([
          [
            'github',
            [
              {
                id: 'issue_read',
                description: 'Read issues.',
                sensitivity: 'read',
                sensitive: false,
                requiredScope: [],
                result: 'json',
                inputSchema: {type: 'object'},
              },
            ],
          ],
        ]),
        workspaceConnectionSnapshot: new Map([
          ['github-main', {id: 'connection-1', provider: 'github', capabilities: ['agent_tools']}],
        ]),
        defaultConnection: {id: 'connection-1', slug: 'github-main', provider: 'github'},
      },
    });

    await expect(materialized).rejects.toThrow(AgentIntegrationMaterializationError);
    await expect(materialized).rejects.toMatchObject({
      reason: 'mcp-server-name-collision',
      connection: 'github-main',
    });
  });
});
