import {createApiClient} from '@shipfox/e2e-core';
import {message, startFakeOpenAiModelProvider, toolCall} from '@shipfox/e2e-driver-model-provider';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {createAnthropicFakeModelProviderConfig} from '@shipfox/e2e-setup-agent';
import {createLinearConnection} from '@shipfox/e2e-setup-integrations';
import {attachLocalRunnerLog} from '#attachments.js';
import {
  LINEAR_READ_RESULT_MARKER,
  LINEAR_WRITE_RESULT_MARKER,
  startLinearMcpMock,
} from '#linear-mcp.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import type {SuiteContext} from '#suite-context.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {seedAndWaitForDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const CLAUDE_AGENT_MODEL = 'deterministic-linear-tools-agent';
const TERMINAL_TIMEOUT_MS = 60_000;

test.describe.configure({mode: 'serial'});

test('runs Linear read and write tools through the agent-step MCP path', async ({
  suite,
}, testInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const accessToken = `linear-e2e-token-${uniqueId}`;
  const mcpMock = await startLinearMcpMock();
  let fakeModelProvider: Awaited<ReturnType<typeof startFakeOpenAiModelProvider>> | undefined;

  try {
    fakeModelProvider = await startFakeOpenAiModelProvider({
      runId: `${suite.runId}-linear-agent-tools-${uniqueId}`,
    });
    const connection = await createLinearConnection({
      workspaceId: suite.workspaceId,
      organizationId: `linear-org-${uniqueId}`,
      organizationUrlKey: `e2e-${uniqueId}`,
      appUserId: `linear-app-user-${uniqueId}`,
      displayName: `Linear E2E ${uniqueId}`,
      accessToken,
    });
    const getIssueTool = `mcp__shipfox_integration_tools__${connection.slug}__get_issue`;
    const saveCommentTool = `mcp__shipfox_integration_tools__${connection.slug}__save_comment`;
    const fakeAnthropic = await createAnthropicFakeModelProviderConfig({
      workspaceId: suite.workspaceId,
      fakeModelProvider,
      scriptId: `${suite.runId}-linear-agent-tools-${uniqueId}`,
      model: CLAUDE_AGENT_MODEL,
      responses: [
        toolCall(getIssueTool, {id: 'ENG-878'}),
        toolCall(saveCommentTool, {issueId: 'ENG-878', body: 'Synthetic Linear comment'}),
        message('done'),
      ],
      assertions: [
        {kind: 'model', equals: CLAUDE_AGENT_MODEL},
        {kind: 'tool_present', name: getIssueTool},
        {kind: 'tool_present', name: saveCommentTool},
        {
          kind: 'message_content_includes',
          value: LINEAR_READ_RESULT_MARKER,
          minRequestIndex: 1,
        },
        {
          kind: 'message_content_includes',
          value: LINEAR_WRITE_RESULT_MARKER,
          minRequestIndex: 2,
        },
      ],
      setAsDefault: true,
    });

    const terminal = await runLinearToolsWorkflow({
      suite,
      testInfo,
      uniqueId,
      connectionSlug: connection.slug,
      runnerEnv: fakeAnthropic.runnerEnv,
    });

    expect(terminal.status).toBe('succeeded');
    expect(terminal.jobs.find((job) => job.key === 'tools')?.status).toBe('succeeded');
    expect(mcpMock.endpoint.toString()).toBe(process.env.LINEAR_MCP_ENDPOINT);
    expect(mcpMock.endpoint.hostname).toBe('127.0.0.1');
    expect(mcpMock.endpoint.hostname).not.toBe('mcp.linear.app');
    expect(mcpMock.calls).toEqual([
      {
        authorization: `Bearer ${accessToken}`,
        arguments: {id: 'ENG-878'},
        toolName: 'get_issue',
      },
      {
        authorization: `Bearer ${accessToken}`,
        arguments: {issueId: 'ENG-878', body: 'Synthetic Linear comment'},
        toolName: 'save_comment',
      },
    ]);
  } finally {
    await Promise.all([
      fakeModelProvider?.stop()?.catch((error: unknown) => {
        process.stderr.write(
          `linear-agent-tools-e2e: stopFakeOpenAiModelProvider failed: ${String(error)}\n`,
        );
      }) ?? Promise.resolve(),
      mcpMock.stop().catch((error: unknown) => {
        process.stderr.write(
          `linear-agent-tools-e2e: stopLinearMcpMock failed: ${String(error)}\n`,
        );
      }),
    ]);
  }
});

async function runLinearToolsWorkflow(params: {
  suite: SuiteContext;
  testInfo: {
    attach: (name: string, options: {body: Buffer | string; contentType: string}) => Promise<void>;
  };
  uniqueId: string;
  connectionSlug: string;
  runnerEnv: Record<string, string>;
}) {
  const token = params.suite.sessionToken;
  const client = createApiClient({token});
  const scenario = 'linear-agent-tools';
  const runnerLabel = `e2e-${scenario}-${params.uniqueId}`;
  const repo = `${scenario}-${params.uniqueId}`;
  const localRunner = await startSuiteLocalRunner({
    workspaceId: params.suite.workspaceId,
    userToken: token,
    name: `E2E ${scenario} ${params.uniqueId}`,
    runnerLabel,
    extraEnv: {
      ...params.runnerEnv,
      SHIPFOX_POLL_MAX_DURATION_MS: String(TERMINAL_TIMEOUT_MS),
    },
  });

  try {
    const {definition} = await seedAndWaitForDefinition({
      suite: params.suite,
      token,
      name: scenario,
      repo,
      runnerLabel,
      workflowYaml: linearToolsWorkflowYaml(params.connectionSlug),
      configPath: `.shipfox/workflows/${scenario}.yml`,
    });
    const runId = await fireManualAndAwaitRun({
      client,
      definitionId: definition.id,
      inputs: {},
      scenario,
    });

    return await waitForRunTerminalOrFailedRunner({
      runId,
      token,
      timeoutMs: TERMINAL_TIMEOUT_MS,
      runner: localRunner.runner,
    });
  } finally {
    await attachLocalRunnerLog(
      (attachment) =>
        params.testInfo.attach(attachment.name, {
          body: attachment.body,
          contentType: attachment.contentType,
        }),
      localRunner.logFile,
    );
    await stopLocalRunner(localRunner.runner).catch((error: unknown) => {
      process.stderr.write(`${scenario}-e2e: stopLocalRunner failed: ${String(error)}\n`);
    });
  }
}

function linearToolsWorkflowYaml(connectionSlug: string): string {
  return `
name: Linear agent tools
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  tools:
    steps:
      - key: linear
        harness: claude
        thinking: low
        prompt: Use the selected Linear tools.
        integrations:
          - connection: ${connectionSlug}
            include: [get_issue, save_comment]
            allow_write: true
`;
}
