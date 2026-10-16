import {readFile} from 'node:fs/promises';
import {createApiClient} from '@shipfox/e2e-core';
import {message, startFakeOpenAiModelProvider, toolCall} from '@shipfox/e2e-driver-model-provider';
import {localRunnerLogTail, stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {fetchStepLogs} from '@shipfox/e2e-observe-logs';
import {
  createOpenAiCompatibleCustomProvider,
  deleteModelProviderConfig,
} from '@shipfox/e2e-setup-agent';
import {createSecret} from '@shipfox/e2e-setup-secrets';
import {startFakeHttpMcpServer} from '#fake-http-mcp-server.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {seedProjectWithApiDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const NAME = 'custom-mcp-servers';
const MODEL = 'deterministic-custom-mcp-servers';
const TERMINAL_TIMEOUT_MS = 90_000;
const SECRET_ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const SERVER_PATH = '.shipfox/mcp/fake-stdio-mcp-server.sh';
const FAKE_SERVER = new URL('../fixtures/mcp-server/fake-stdio-mcp-server.sh', import.meta.url);

test('runs stdio and url MCP servers that read secrets, and masks the secrets in the transcript', async ({
  suite,
}, testInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const secretKey = `MCP_E2E_TOKEN_${uniqueId.toUpperCase()}`;
  const secretValue = `mcp-e2e-secret-${uniqueId}`;
  const derived = `length=${secretValue.length}`;
  const headerSecretKey = `MCP_E2E_HEADER_TOKEN_${uniqueId.toUpperCase()}`;
  const headerSecretValue = `mcp-e2e-header-secret-${uniqueId}`;
  const headerDerived = `header_length:${headerSecretValue.length}`;
  const token = suite.sessionToken;
  const fakeModelProvider = await startFakeOpenAiModelProvider({runId: `${suite.runId}-${NAME}`});
  const httpServer = await startFakeHttpMcpServer(headerSecretValue);
  let providerId: string | undefined;

  try {
    for (const [key, value] of [
      [secretKey, secretValue],
      [headerSecretKey, headerSecretValue],
    ] as const) {
      await createSecret({workspaceId: suite.workspaceId, actorId: SECRET_ACTOR_ID, key, value});
    }
    const script = await fakeModelProvider.createScript({
      id: `${suite.runId}-${NAME}-${uniqueId}`,
      model: MODEL,
      responses: [
        message('provider probe ok'),
        toolCall('fake__reveal', {}),
        toolCall('docs__reveal', {}),
        message('done'),
      ],
      assertions: [
        {kind: 'tool_present', name: 'fake__reveal', minRequestIndex: 1},
        {kind: 'tool_present', name: 'docs__reveal', minRequestIndex: 1},
        {kind: 'message_content_includes', value: derived, minRequestIndex: 2},
        {kind: 'message_content_includes', value: headerDerived, minRequestIndex: 3},
      ],
    });
    const provider = await createOpenAiCompatibleCustomProvider({
      workspaceId: suite.workspaceId,
      sessionToken: token,
      providerId: `fake-${NAME}-${uniqueId}`,
      displayName: `Fake custom MCP servers ${uniqueId}`,
      baseUrl: script.modelProviderBaseUrl,
      model: script.model,
    });
    providerId = provider.provider_id;

    const runnerLabel = `e2e-${NAME}-${uniqueId}`;
    const localRunner = await startSuiteLocalRunner({
      workspaceId: suite.workspaceId,
      userToken: token,
      name: `E2E ${NAME} ${uniqueId}`,
      runnerLabel,
      extraEnv: {SHIPFOX_POLL_MAX_DURATION_MS: String(TERMINAL_TIMEOUT_MS)},
    });
    try {
      const {definition} = await seedProjectWithApiDefinition({
        suite,
        token,
        name: NAME,
        repo: `${NAME}-${uniqueId}`,
        runnerLabel,
        workflowYaml: workflowYaml({
          provider: provider.provider_id,
          model: script.model,
          secretKey,
          headerSecretKey,
          httpServerUrl: httpServer.url,
        }),
        configPath: `.shipfox/workflows/${NAME}.yml`,
        extraFiles: [{path: SERVER_PATH, content: await readFile(FAKE_SERVER, 'utf8')}],
      });
      const runId = await fireManualAndAwaitRun({
        client: createApiClient({token}),
        definitionId: definition.id,
        inputs: {},
        scenario: NAME,
      });
      const terminal = await waitForRunTerminalOrFailedRunner({
        runId,
        token,
        timeoutMs: TERMINAL_TIMEOUT_MS,
        runner: localRunner.runner,
        selection: {jobs: [{jobKey: 'tools', includeDefaultExecution: true, stepKeys: ['agent']}]},
      });
      const step = terminal.jobs
        .find((job) => job.key === 'tools')
        ?.executions.flatMap((execution) => execution.steps)
        .find((candidate) => candidate.key === 'agent');
      if (terminal.status !== 'succeeded') {
        await testInfo.attach('custom-mcp-servers-model-requests.json', {
          body: JSON.stringify(await fakeModelProvider.getRequests(script.id), null, 2),
          contentType: 'application/json',
        });
      }

      expect(
        terminal.status,
        `${JSON.stringify(step?.error ?? null)}${localRunnerLogTail(localRunner.logFile)}`,
      ).toBe('succeeded');
      if (step === undefined) throw new Error('The agent step is missing');
      const logs = await fetchStepLogs({stepId: step.id, attempt: step.current_attempt, token});
      expect(logs.ndjson).toContain(derived);
      expect(logs.ndjson).toContain(headerDerived);
      expect(logs.ndjson).not.toContain(secretValue);
      expect(logs.ndjson).not.toContain(headerSecretValue);
    } finally {
      await stopLocalRunner(localRunner.runner).catch(() => undefined);
    }
  } finally {
    if (providerId !== undefined) {
      await deleteModelProviderConfig({
        workspaceId: suite.workspaceId,
        sessionToken: token,
        providerId,
      }).catch(() => undefined);
    }
    await fakeModelProvider.stop().catch(() => undefined);
    await httpServer.close();
  }
});

function workflowYaml(params: {
  provider: string;
  model: string;
  secretKey: string;
  headerSecretKey: string;
  httpServerUrl: string;
}): string {
  return `
name: Custom MCP servers
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  tools:
    steps:
      - key: agent
        harness: pi
        provider: ${params.provider}
        model: ${params.model}
        thinking: off
        prompt: Call the reveal tool of each fake MCP server.
        mcp_servers:
          fake:
            command: sh
            args: [${SERVER_PATH}]
            env:
              FAKE_SECRET: \${{ secrets.${params.secretKey} }}
            include: [reveal]
          docs:
            url: ${params.httpServerUrl}
            headers:
              Authorization: Bearer \${{ secrets.${params.headerSecretKey} }}
`;
}
