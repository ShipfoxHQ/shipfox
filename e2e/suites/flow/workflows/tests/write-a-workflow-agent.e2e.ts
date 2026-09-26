import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {
  agentAccessEnvelopeSchema,
  createDevRunResultSchema,
  getWorkflowAuthoringContextResultSchema,
  listWorkspaceModelsResultSchema,
} from '@shipfox/api-agent-access-dto';
import {config} from '@shipfox/e2e-core';
import {message, startFakeOpenAiModelProvider} from '@shipfox/e2e-driver-model-provider';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {
  createOpenAiCompatibleCustomProvider,
  deleteModelProviderConfig,
} from '@shipfox/e2e-setup-agent';
import {authorizeAgentAccess} from '@shipfox/e2e-setup-auth';
import {attachLocalRunnerLog} from '#attachments.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import {seedWorkflowProject} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const JOB_KEY = 'answer';
const STEP_KEY = 'reply';
const TERMINAL_TIMEOUT_MS = 60_000;

// Follows `write-a-workflow` step 3 without a template. Several suite providers offer the
// chosen model ID, so only the written `provider` selects the user's choice.
test('writes a workflow with a catalog model that resolves to the chosen provider', async ({
  request,
  suite,
}, testInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const scenario = `write-a-workflow-agent-${uniqueId}`;
  const runnerLabel = `e2e-${scenario}`;
  const fakeModelProvider = await startFakeOpenAiModelProvider({
    runId: `${suite.runId}-${scenario}`,
  });
  let providerId: string | undefined;
  let localRunner: Awaited<ReturnType<typeof startSuiteLocalRunner>> | undefined;
  let client: Client | undefined;

  try {
    const script = await fakeModelProvider.createScript({
      id: `${suite.runId}-${scenario}`,
      model: suite.agentModel,
      responses: Array.from({length: 4}, () => message('ok')),
      assertions: [{kind: 'model', equals: suite.agentModel}],
    });
    const provider = await createOpenAiCompatibleCustomProvider({
      workspaceId: suite.workspaceId,
      sessionToken: suite.sessionToken,
      providerId: `write-workflow-${uniqueId}`,
      displayName: `Write a workflow ${uniqueId}`,
      baseUrl: script.modelProviderBaseUrl,
      model: script.model,
      modelMetadata: {max_output_tokens: 64},
    });
    providerId = provider.provider_id;
    const {project} = await seedWorkflowProject({
      suite,
      token: suite.sessionToken,
      name: scenario,
      repo: scenario,
      runnerLabel,
      workflowYaml: '',
      configPath: `.shipfox/workflows/${scenario}.yml`,
      definitionDelivery: 'api',
    });
    client = await connectAgentAccessClient({request, suite, uniqueId});

    const context = await callToolResult(
      client,
      'get_workflow_authoring_context',
      {project_id: project.id},
      getWorkflowAuthoringContextResultSchema,
    );
    const sameModelId = await callToolResult(
      client,
      'list_workspace_models',
      {query: suite.agentModel},
      listWorkspaceModelsResultSchema,
    );
    const chosenProvider = await callToolResult(
      client,
      'list_workspace_models',
      {provider: provider.provider_id},
      listWorkspaceModelsResultSchema,
    );
    const chosen = chosenProvider.models[0];
    if (chosen === undefined) throw new Error('The chosen provider listed no model');

    expect(context).not.toHaveProperty('models');
    expect(context.model_provider_configured).toBe(true);
    expect(context.model_count).toBeGreaterThanOrEqual(sameModelId.models.length);
    expect(context.default_model?.provider).not.toBe(provider.provider_id);
    expect(new Set(sameModelId.models.map(({provider}) => provider)).size).toBeGreaterThan(1);
    expect(chosenProvider).toEqual({
      models: [expect.objectContaining({id: suite.agentModel, provider: provider.provider_id})],
      next_cursor: null,
    });
    expect(chosen.supported_thinking).toContain('off');

    const workflowYaml = `
name: Write a workflow agent
runner: ${runnerLabel}
triggers:
  manual:
    source: manual
    event: fire
jobs:
  ${JOB_KEY}:
    steps:
      - key: ${STEP_KEY}
        harness: ${chosen.harness}
        provider: ${chosen.provider}
        model: ${chosen.id}
        thinking: off
        prompt: |
          Reply with exactly the word: ok
          Do not include any other text.
`;
    const devRunInput = {
      project_id: project.id,
      config_path: `.shipfox/workflows/${scenario}.yml`,
      ref: 'refs/heads/main',
      trigger: 'manual',
      content: workflowYaml,
    };
    const dryRun = await callToolResult(
      client,
      'create_dev_run',
      {...devRunInput, dry_run: true},
      createDevRunResultSchema,
    );
    expect(dryRun).toMatchObject({dry_run: true, check_passed: true});

    localRunner = await startSuiteLocalRunner({
      workspaceId: suite.workspaceId,
      userToken: suite.sessionToken,
      name: `E2E ${scenario}`,
      runnerLabel,
      extraEnv: {SHIPFOX_POLL_MAX_DURATION_MS: String(TERMINAL_TIMEOUT_MS)},
    });
    const devRun = await callToolResult(
      client,
      'create_dev_run',
      devRunInput,
      createDevRunResultSchema,
    );
    if (!('run_id' in devRun)) throw new Error('The dev run did not return a run id');
    const terminal = await waitForRunTerminalOrFailedRunner({
      runId: devRun.run_id,
      token: suite.sessionToken,
      timeoutMs: TERMINAL_TIMEOUT_MS,
      runner: localRunner.runner,
      selection: {jobs: [{jobKey: JOB_KEY, includeDefaultExecution: true, stepKeys: [STEP_KEY]}]},
    });
    const step = terminal.jobs
      .find(({key}) => key === JOB_KEY)
      ?.executions.flatMap(({steps}) => steps)
      .find(({key}) => key === STEP_KEY);

    expect(terminal.status).toBe('succeeded');
    expect(step?.response?.trim()).toBe('ok');
    expect(step?.attempt_details[0]?.config).toMatchObject({
      provider: provider.provider_id,
      model: suite.agentModel,
      harness: chosen.harness,
      thinking: 'off',
    });
  } finally {
    await client?.close();
    if (localRunner !== undefined) {
      const {logFile, runner} = localRunner;
      await attachLocalRunnerLog(
        (attachment) =>
          testInfo.attach(attachment.name, {
            body: attachment.body,
            contentType: attachment.contentType,
          }),
        logFile,
      );
      await stopLocalRunner(runner).catch(() => undefined);
    }
    if (providerId !== undefined) {
      await deleteModelProviderConfig({
        workspaceId: suite.workspaceId,
        sessionToken: suite.sessionToken,
        providerId,
      }).catch(() => undefined);
    }
    await fakeModelProvider.stop().catch(() => undefined);
  }
});

async function connectAgentAccessClient(params: {
  request: Parameters<typeof authorizeAgentAccess>[0]['request'];
  suite: {sessionToken: string; workspaceId: string};
  uniqueId: string;
}): Promise<Client> {
  const apiOrigin = new URL(config.API_URL).origin;
  const token = await authorizeAgentAccess({
    request: params.request,
    apiOrigin,
    publicOrigin: new URL(config.API_PUBLIC_URL).origin,
    sessionToken: params.suite.sessionToken,
    workspaceId: params.suite.workspaceId,
    clientName: `Write a workflow E2E ${params.uniqueId}`,
    redirectUri: `http://127.0.0.1:43123/${params.uniqueId}/oauth/callback`,
  });
  const client = new Client({name: 'write-a-workflow-e2e-client', version: '0.0.0'});
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', apiOrigin), {
    requestInit: {
      headers: {
        authorization: `Bearer ${token.access_token}`,
        origin: new URL(config.CLIENT_BASE_URL).origin,
      },
    },
  });
  await client.connect(transport as unknown as Transport);
  return client;
}

async function callToolResult<T>(
  client: Client,
  name: string,
  arguments_: Record<string, unknown>,
  schema: {parse: (value: unknown) => T},
): Promise<T> {
  const call = await client.callTool({name, arguments: arguments_}, CallToolResultSchema);
  const envelope = agentAccessEnvelopeSchema.parse(call.structuredContent);
  if (!envelope.ok) {
    throw new Error(`${name} returned ${envelope.error?.code ?? 'an error'}`);
  }
  return schema.parse(envelope.result);
}
