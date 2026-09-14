import {message, startFakeOpenAiModelProvider, toolCall} from '@shipfox/e2e-driver-model-provider';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {createAnthropicFakeModelProviderConfig} from '@shipfox/e2e-setup-agent';
import {createClickUpConnection} from '@shipfox/e2e-setup-integrations';
import {
  attachLocalRunnerLog,
  collectStepLogAttachmentRequests,
  fetchLogAttachment,
} from '#attachments.js';
import {
  CLICKUP_COMMENT_RESULT_MARKER,
  CLICKUP_TASK_RESULT_MARKER,
  startClickUpApiMock,
} from '#clickup-api.js';
import {
  expectNoClickUpRun,
  postClickUpCommentDelivery,
  triggerClickUpCommentAndAwaitRun,
} from '#clickup-events.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import type {SuiteContext} from '#suite-context.js';
import {seedProjectWithApiDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

type ClickUpTestInfo = {
  attach: (name: string, options: {body: Buffer | string; contentType: string}) => Promise<void>;
};

const CLAUDE_AGENT_MODEL = 'deterministic-clickup-tools-agent';
const CLICKUP_TERMINAL_TIMEOUT_MS = 60_000;

test.describe.configure({mode: 'serial'});

test('starts a run from a signed ClickUp comment and calls ClickUp agent tools', async ({
  suite,
}: {suite: SuiteContext}, testInfo: ClickUpTestInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const taskId = `task-${uniqueId}`;
  const webhookId = `webhook-${uniqueId}`;
  const webhookSecret = `secret-${uniqueId}`;
  const authorizingUserId = `authorizing-user-${uniqueId}`;
  const accessToken = `clickup-access-token-${uniqueId}`;
  const commentText = 'Please read this task and report back.';
  const replyText = 'I read the ClickUp task.';
  const clickupApi = await startClickUpApiMock();
  let fakeModelProvider: Awaited<ReturnType<typeof startFakeOpenAiModelProvider>> | undefined;
  let localRunner: Awaited<ReturnType<typeof startSuiteLocalRunner>> | undefined;

  try {
    const scriptId = `${suite.runId}-clickup-agent-tools-${uniqueId}`;
    fakeModelProvider = await startFakeOpenAiModelProvider({runId: scriptId});
    const connection = await createClickUpConnection({
      workspaceId: suite.workspaceId,
      teamId: `team-${uniqueId}`,
      teamName: `E2E ClickUp ${uniqueId}`,
      authorizingUserId,
      accessToken,
      webhookId,
      webhookSecret,
      displayName: `ClickUp E2E ${uniqueId}`,
    });
    const getTaskTool = `mcp__shipfox_integration_tools__${connection.slug}__get_task`;
    const addCommentTool = `mcp__shipfox_integration_tools__${connection.slug}__add_comment`;
    const fakeAnthropic = await createAnthropicFakeModelProviderConfig({
      workspaceId: suite.workspaceId,
      fakeModelProvider,
      scriptId,
      model: CLAUDE_AGENT_MODEL,
      responses: [
        toolCall(getTaskTool, {task_id: taskId}),
        toolCall(addCommentTool, {task_id: taskId, body: replyText}),
        message('done'),
      ],
      assertions: [
        {kind: 'model', equals: CLAUDE_AGENT_MODEL},
        {kind: 'tool_present', name: getTaskTool},
        {kind: 'tool_present', name: addCommentTool},
        {
          kind: 'message_content_includes',
          value: CLICKUP_TASK_RESULT_MARKER,
          minRequestIndex: 1,
        },
        {
          kind: 'message_content_includes',
          value: CLICKUP_COMMENT_RESULT_MARKER,
          minRequestIndex: 2,
        },
      ],
      setAsDefault: true,
    });

    const runnerLabel = `e2e-clickup-agent-tools-${uniqueId}`;
    localRunner = await startSuiteLocalRunner({
      workspaceId: suite.workspaceId,
      userToken: suite.sessionToken,
      name: `E2E ClickUp agent tools ${uniqueId}`,
      runnerLabel,
      extraEnv: {
        ...fakeAnthropic.runnerEnv,
        SHIPFOX_POLL_MAX_DURATION_MS: String(CLICKUP_TERMINAL_TIMEOUT_MS),
      },
    });

    const {project} = await seedProjectWithApiDefinition({
      suite,
      token: suite.sessionToken,
      name: 'clickup-agent-tools',
      repo: `clickup-agent-tools-${uniqueId}`,
      runnerLabel,
      workflowYaml: clickupToolsWorkflowYaml(connection.slug),
      configPath: '.shipfox/workflows/clickup-agent-tools.yml',
    });
    const trigger = await triggerClickUpCommentAndAwaitRun({
      projectId: project.id,
      workspaceId: suite.workspaceId,
      token: suite.sessionToken,
      webhookSecret,
      webhookId,
      connectionId: connection.id,
      taskId,
      actorId: `human-user-${uniqueId}`,
      commentText,
    });
    const terminal = await waitForRunTerminalOrFailedRunner({
      runId: trigger.runId,
      token: suite.sessionToken,
      timeoutMs: CLICKUP_TERMINAL_TIMEOUT_MS,
      runner: localRunner.runner,
      selection: {
        jobs: [{jobKey: 'tools', includeDefaultExecution: true, stepKeys: ['clickup']}],
      },
    });
    if (terminal.status !== 'succeeded') {
      for (const request of collectStepLogAttachmentRequests(terminal)) {
        const attachment = await fetchLogAttachment(request, suite.sessionToken);
        await testInfo.attach(attachment.name, {
          body: attachment.body,
          contentType: attachment.contentType,
        });
      }
    }

    expect(terminal.status).toBe('succeeded');
    expect(terminal.jobs.find((job) => job.key === 'tools')?.status).toBe('succeeded');
    expect(clickupApi.endpoint.toString()).toBe(
      new URL(process.env.CLICKUP_API_BASE_URL ?? 'http://invalid.local').toString(),
    );
    expect(clickupApi.calls).toEqual([
      {
        kind: 'get_task',
        authorization: `Bearer ${accessToken}`,
        taskId,
        query: {include_markdown_description: 'true'},
      },
      {
        kind: 'add_comment',
        authorization: `Bearer ${accessToken}`,
        taskId,
        query: {},
        body: {comment_text: replyText, notify_all: false},
      },
    ]);
    const providerRequests = await fakeModelProvider.getRequests(scriptId);
    expect(providerRequests.some((request) => request.tools.includes(getTaskTool))).toBe(true);
    expect(providerRequests.some((request) => request.tools.includes(addCommentTool))).toBe(true);
    expect(providerRequests.every((request) => request.assertion_failures.length === 0)).toBe(true);

    const selfAuthoredDeliveryId = await postClickUpCommentDelivery({
      webhookSecret,
      webhookId,
      connectionId: connection.id,
      taskId,
      historyItemId: `self-authored-${crypto.randomUUID().replaceAll('-', '')}`,
      actorId: authorizingUserId,
      commentText: 'This delivery must be ignored by loop safety.',
    });
    const expectedClickUpCallCount = 2;
    await expectNoClickUpRun({
      projectId: project.id,
      workspaceId: suite.workspaceId,
      token: suite.sessionToken,
      deliveryId: selfAuthoredDeliveryId,
      expectedClickUpCallCount,
      getClickUpCallCount: () => clickupApi.calls.length,
    });
    expect(clickupApi.calls).toHaveLength(expectedClickUpCallCount);
  } finally {
    if (localRunner !== undefined) {
      await attachLocalRunnerLog(
        (attachment) =>
          testInfo.attach(attachment.name, {
            body: attachment.body,
            contentType: attachment.contentType,
          }),
        localRunner.logFile,
      );
    }
    await Promise.all([
      fakeModelProvider?.stop()?.catch((error: unknown) => {
        process.stderr.write(
          `clickup-agent-tools-e2e: stopFakeOpenAiModelProvider failed: ${String(error)}\n`,
        );
      }) ?? Promise.resolve(),
      clickupApi.stop().catch((error: unknown) => {
        process.stderr.write(
          `clickup-agent-tools-e2e: stopClickUpApiMock failed: ${String(error)}\n`,
        );
      }),
      localRunner === undefined
        ? Promise.resolve()
        : stopLocalRunner(localRunner.runner).catch((error: unknown) => {
            process.stderr.write(
              `clickup-agent-tools-e2e: stopLocalRunner failed: ${String(error)}\n`,
            );
          }),
    ]);
  }
});

function clickupToolsWorkflowYaml(connectionSlug: string): string {
  return `
name: ClickUp agent tools
runner: __RUNNER_LABEL__
triggers:
  on_comment:
    source: ${connectionSlug}
    event: taskCommentPosted
jobs:
  tools:
    steps:
      - key: clickup
        harness: claude
        provider: anthropic
        thinking: low
        prompt: Read the triggering ClickUp task and comment back.
        integrations:
          - connection: ${connectionSlug}
            include: [get_task, add_comment]
            allow_write: true
`;
}
