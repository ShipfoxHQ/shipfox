import {createApiClient, pollUntil} from '@shipfox/e2e-core';
import {message, startFakeOpenAiModelProvider, toolCall} from '@shipfox/e2e-driver-model-provider';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {createAnthropicFakeModelProviderConfig} from '@shipfox/e2e-setup-agent';
import {createPosthogConnection} from '@shipfox/e2e-setup-integrations';
import {attachLocalRunnerLog} from '#attachments.js';
import {
  type PosthogMockCall,
  posthogMockCalls,
  releasePosthogCall,
  setPosthogProbeStatus,
  waitForPosthogMockCall,
} from '#posthog-api.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {seedProjectWithApiDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const TERMINAL_TIMEOUT_MS = 60_000;
const POSTHOG_AGENT_TOOL_STEP_RE = / {6}- key: sql[\s\S]*$/u;

test.describe.configure({mode: 'serial'});

test('runs PostHog agent and tool steps through the regional MCP fake', async ({
  suite,
}, testInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const apiKey = `phx-flow-${uniqueId}`;
  const connection = await createPosthogConnection({
    workspaceId: suite.workspaceId,
    region: 'us',
    apiKey,
    projectId: `project-${uniqueId}`,
    projectName: `PostHog flow ${uniqueId}`,
    organizationId: `organization-${uniqueId}`,
  });
  const toolName = `mcp__shipfox_integration_tools__${connection.slug}__execute-sql`;
  const fakeModelProvider = await startFakeOpenAiModelProvider({
    runId: `${suite.runId}-posthog-${uniqueId}`,
  });
  let localRunner: Awaited<ReturnType<typeof startSuiteLocalRunner>> | undefined;

  try {
    const fakeAnthropic = await createAnthropicFakeModelProviderConfig({
      workspaceId: suite.workspaceId,
      fakeModelProvider,
      scriptId: `${suite.runId}-posthog-${uniqueId}`,
      model: 'deterministic-posthog-agent',
      responses: [
        toolCall(toolName, {query: 'SELECT 1 AS agent_probe'}),
        message('PostHog query complete.'),
      ],
      assertions: [
        {kind: 'tool_present', name: toolName},
        {
          kind: 'message_content_includes',
          value: 'posthog-e2e-result:execute-sql',
          minRequestIndex: 1,
        },
      ],
      setAsDefault: true,
    });
    const runnerLabel = `e2e-posthog-${uniqueId}`;
    localRunner = await startSuiteLocalRunner({
      workspaceId: suite.workspaceId,
      userToken: suite.sessionToken,
      name: `E2E PostHog ${uniqueId}`,
      runnerLabel,
      extraEnv: {
        ...fakeAnthropic.runnerEnv,
        SHIPFOX_POLL_MAX_DURATION_MS: String(TERMINAL_TIMEOUT_MS),
      },
    });

    const {definition} = await seedProjectWithApiDefinition({
      suite,
      token: suite.sessionToken,
      name: 'posthog-agent-and-tool',
      repo: `posthog-agent-and-tool-${uniqueId}`,
      runnerLabel,
      workflowYaml: posthogAgentAndToolWorkflow(connection.slug),
      configPath: '.shipfox/workflows/posthog-agent-and-tool.yml',
    });
    const runId = await fireManualAndAwaitRun({
      client: createApiClient({token: suite.sessionToken}),
      definitionId: definition.id,
      inputs: {},
      scenario: 'posthog-agent-and-tool',
    });
    const terminal = await waitForRunTerminalOrFailedRunner({
      runId,
      token: suite.sessionToken,
      timeoutMs: TERMINAL_TIMEOUT_MS,
      runner: localRunner.runner,
    });

    expect(terminal.status).toBe('succeeded');
    expect(terminal.jobs.find((job) => job.key === 'tools')?.status).toBe('succeeded');
    const calls = await waitForPosthogCalls(apiKey, 2);
    expect(process.env.POSTHOG_MCP_ENDPOINT).toBeTruthy();
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.headers['x-posthog-mcp-mode'] === 'tools')).toBe(true);
    expect(calls.every((call) => call.headers['x-posthog-read-only'] === 'true')).toBe(true);
    expect(
      calls.every((call) => call.headers['x-posthog-project-id'] === `project-${uniqueId}`),
    ).toBe(true);
    expect(
      calls.every(
        (call) => call.headers['x-posthog-organization-id'] === `organization-${uniqueId}`,
      ),
    ).toBe(true);
    expect(calls.map((call) => call.tool_name)).toEqual(['execute-sql', 'execute-sql']);
  } finally {
    if (localRunner) {
      await attachLocalRunnerLog(
        (attachment) =>
          testInfo.attach(attachment.name, {
            body: attachment.body,
            contentType: attachment.contentType,
          }),
        localRunner.logFile,
      ).catch(() => undefined);
      await stopLocalRunner(localRunner.runner).catch(() => undefined);
    }
    await fakeModelProvider.stop().catch(() => undefined);
  }
});

test('marks a revoked PostHog key and fails the next call fast', async ({suite}) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const apiKey = `phx-revoked-${uniqueId}`;
  const connection = await createPosthogConnection({
    workspaceId: suite.workspaceId,
    region: 'eu',
    apiKey,
    projectId: `revoked-project-${uniqueId}`,
    projectName: `Revoked PostHog ${uniqueId}`,
    organizationId: `organization-${uniqueId}`,
  });
  const fakeModelProvider = await startFakeOpenAiModelProvider({
    runId: `${suite.runId}-posthog-revoked-${uniqueId}`,
  });
  let localRunner: Awaited<ReturnType<typeof startSuiteLocalRunner>> | undefined;

  try {
    const toolName = `mcp__shipfox_integration_tools__${connection.slug}__execute-sql`;
    const fakeAnthropic = await createAnthropicFakeModelProviderConfig({
      workspaceId: suite.workspaceId,
      fakeModelProvider,
      scriptId: `${suite.runId}-posthog-revoked-${uniqueId}`,
      model: 'deterministic-posthog-revoked-agent',
      responses: [toolCall(toolName, {query: 'SELECT 1'})],
      assertions: [{kind: 'tool_present', name: toolName}],
      setAsDefault: true,
    });
    const runnerLabel = `e2e-posthog-revoked-${uniqueId}`;
    localRunner = await startSuiteLocalRunner({
      workspaceId: suite.workspaceId,
      userToken: suite.sessionToken,
      name: `E2E revoked PostHog ${uniqueId}`,
      runnerLabel,
      extraEnv: {
        ...fakeAnthropic.runnerEnv,
        SHIPFOX_POLL_MAX_DURATION_MS: String(TERMINAL_TIMEOUT_MS),
      },
    });
    const project = await seedProjectWithApiDefinition({
      suite,
      token: suite.sessionToken,
      name: 'posthog-revoked',
      repo: `posthog-revoked-${uniqueId}`,
      runnerLabel,
      workflowYaml: posthogAgentWorkflow(connection.slug),
      configPath: '.shipfox/workflows/posthog-revoked.yml',
    });
    const client = createApiClient({token: suite.sessionToken});
    const firstRun = await fireManualAndAwaitRun({
      client,
      definitionId: project.definition.id,
      inputs: {},
      scenario: 'posthog-revoked-first',
    });
    const firstTerminal = await waitForRunTerminalOrFailedRunner({
      runId: firstRun,
      token: suite.sessionToken,
      timeoutMs: TERMINAL_TIMEOUT_MS,
      runner: localRunner.runner,
    });
    expect(firstTerminal.status).toBe('failed');
    const afterFirst = await listWorkspaceConnections(suite.workspaceId, suite.sessionToken);
    expect(afterFirst.find((item) => item.id === connection.id)?.lifecycle_status).toBe('error');

    const callsBeforeSecondRun = await countPosthogCalls(apiKey);
    const secondRun = await fireManualAndAwaitRun({
      client,
      definitionId: project.definition.id,
      inputs: {},
      scenario: 'posthog-revoked-second',
    });
    const secondTerminal = await waitForRunTerminalOrFailedRunner({
      runId: secondRun,
      token: suite.sessionToken,
      timeoutMs: TERMINAL_TIMEOUT_MS,
      runner: localRunner.runner,
    });
    expect(secondTerminal.status).toBe('failed');
    expect(await countPosthogCalls(apiKey)).toBe(callsBeforeSecondRun);
  } finally {
    if (localRunner) await stopLocalRunner(localRunner.runner).catch(() => undefined);
    await fakeModelProvider.stop().catch(() => undefined);
  }
});

test('keeps a replaced key active when an old PostHog call fails late', async ({suite}) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const oldKey = `phx-stale-single-${uniqueId}`;
  const connection = await createPosthogConnection({
    workspaceId: suite.workspaceId,
    region: 'eu',
    apiKey: oldKey,
    projectId: 'e2e-single-project',
    projectName: `Stale PostHog ${uniqueId}`,
    organizationId: `organization-${uniqueId}`,
  });
  const runnerLabel = `e2e-posthog-stale-${uniqueId}`;
  const localRunner = await startSuiteLocalRunner({
    workspaceId: suite.workspaceId,
    userToken: suite.sessionToken,
    name: `E2E stale PostHog ${uniqueId}`,
    runnerLabel,
    extraEnv: {SHIPFOX_POLL_MAX_DURATION_MS: String(TERMINAL_TIMEOUT_MS)},
  });

  try {
    const {definition} = await seedProjectWithApiDefinition({
      suite,
      token: suite.sessionToken,
      name: 'posthog-stale',
      repo: `posthog-stale-${uniqueId}`,
      runnerLabel,
      workflowYaml: posthogToolWorkflow(connection.slug),
      configPath: '.shipfox/workflows/posthog-stale.yml',
    });
    const client = createApiClient({token: suite.sessionToken});
    const runId = await fireManualAndAwaitRun({
      client,
      definitionId: definition.id,
      inputs: {},
      scenario: 'posthog-stale',
    });
    await waitForPosthogMockCall(oldKey);
    await client.request('put', `/integrations/posthog/connections/${connection.id}/api-key`, {
      json: {api_key: 'phx-single-replacement'},
    });
    await setPosthogProbeStatus(oldKey, 401);
    await releasePosthogCall(oldKey);
    const terminal = await waitForRunTerminalOrFailedRunner({
      runId,
      token: suite.sessionToken,
      timeoutMs: TERMINAL_TIMEOUT_MS,
      runner: localRunner.runner,
    });
    expect(terminal.status).toBe('failed');
    const connections = await listWorkspaceConnections(suite.workspaceId, suite.sessionToken);
    expect(connections.find((item) => item.id === connection.id)?.lifecycle_status).toBe('active');
  } finally {
    await stopLocalRunner(localRunner.runner).catch(() => undefined);
  }
});

async function waitForPosthogCalls(apiKey: string, expected: number) {
  return await pollUntil<PosthogMockCall[]>(
    {
      timeoutMs: TERMINAL_TIMEOUT_MS,
      intervalMs: 100,
      describe: () => `PostHog MCP calls for ${apiKey}`,
    },
    async () => {
      const calls = await posthogMockCalls(apiKey);
      return calls.length >= expected ? calls : null;
    },
  );
}

async function countPosthogCalls(apiKey: string): Promise<number> {
  const calls = await waitForPosthogCalls(apiKey, 0);
  return calls.length;
}

async function listWorkspaceConnections(workspaceId: string, token: string) {
  const client = createApiClient({token});
  const response = await client.requestJson<{
    connections: Array<{id: string; lifecycle_status: string}>;
  }>('get', `/integration-connections?workspace_id=${encodeURIComponent(workspaceId)}`);
  return response.connections;
}

function posthogAgentAndToolWorkflow(connectionSlug: string): string {
  return `
name: PostHog agent and tool
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  tools:
    steps:
      - key: agent
        harness: claude
        provider: anthropic
        thinking: low
        prompt: Run the PostHog SQL tool.
        integrations:
          - connection: ${connectionSlug}
            include: [execute-sql]
      - key: sql
        tool: execute-sql
        connection: ${connectionSlug}
        with:
          query: SELECT 1 AS tool_probe
`;
}

function posthogAgentWorkflow(connectionSlug: string): string {
  return posthogAgentAndToolWorkflow(connectionSlug).replace(POSTHOG_AGENT_TOOL_STEP_RE, '');
}

function posthogToolWorkflow(connectionSlug: string): string {
  return `
name: PostHog tool
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  tools:
    steps:
      - key: sql
        tool: execute-sql
        connection: ${connectionSlug}
        with:
          query: SELECT 1 AS stale_probe
`;
}
