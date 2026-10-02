import {createApiClient} from '@shipfox/e2e-core';
import {
  JIRA_COMMENT_RESULT_MARKER,
  JIRA_ISSUE_RESULT_MARKER,
  startJiraApiMock,
} from '@shipfox/e2e-driver-jira';
import {message, startFakeOpenAiModelProvider, toolCall} from '@shipfox/e2e-driver-model-provider';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {createAnthropicFakeModelProviderConfig} from '@shipfox/e2e-setup-agent';
import {createJiraConnection} from '@shipfox/e2e-setup-integrations';
import {
  attachLocalRunnerLog,
  collectStepLogAttachmentRequests,
  fetchLogAttachment,
} from '#attachments.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import type {SuiteContext} from '#suite-context.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {seedProjectWithApiDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

type JiraTestInfo = {
  attach: (name: string, options: {body: Buffer | string; contentType: string}) => Promise<void>;
};

const CLAUDE_AGENT_MODEL = 'deterministic-jira-tools-agent';
const JIRA_TERMINAL_TIMEOUT_MS = 60_000;

test('runs a Jira read tool and a comment tool against the Jira fake', async ({
  suite,
}: {suite: SuiteContext}, testInfo: JiraTestInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const cloudId = `cloud-${uniqueId}`;
  const issueKey = `E2E-${Math.floor(Math.random() * 9_000) + 1_000}`;
  const accessToken = `jira-access-token-${uniqueId}`;
  const replyText = 'I read the Jira issue.';
  const jiraApi = await startJiraApiMock({accessToken});
  let fakeModelProvider: Awaited<ReturnType<typeof startFakeOpenAiModelProvider>> | undefined;
  let localRunner: Awaited<ReturnType<typeof startSuiteLocalRunner>> | undefined;

  try {
    const scriptId = `${suite.runId}-jira-agent-tools-${uniqueId}`;
    fakeModelProvider = await startFakeOpenAiModelProvider({runId: scriptId});
    const connection = await createJiraConnection({
      workspaceId: suite.workspaceId,
      cloudId,
      siteUrl: `https://${cloudId}.atlassian.example.test`,
      siteName: `E2E Jira ${uniqueId}`,
      authorizingAccountId: `authorizing-account-${uniqueId}`,
      displayName: `Jira E2E ${uniqueId}`,
      accessToken,
    });
    const getIssueTool = `mcp__shipfox_integration_tools__${connection.slug}__get_issue`;
    const addCommentTool = `mcp__shipfox_integration_tools__${connection.slug}__add_comment`;
    const fakeAnthropic = await createAnthropicFakeModelProviderConfig({
      workspaceId: suite.workspaceId,
      fakeModelProvider,
      scriptId,
      model: CLAUDE_AGENT_MODEL,
      responses: [
        toolCall(getIssueTool, {idOrKey: issueKey}),
        toolCall(addCommentTool, {idOrKey: issueKey, body: replyText}),
        message('done'),
      ],
      assertions: [
        {kind: 'model', equals: CLAUDE_AGENT_MODEL},
        {kind: 'tool_present', name: getIssueTool},
        {kind: 'tool_present', name: addCommentTool},
        {
          kind: 'message_content_includes',
          value: JIRA_ISSUE_RESULT_MARKER,
          minRequestIndex: 1,
        },
        {
          kind: 'message_content_includes',
          value: JIRA_COMMENT_RESULT_MARKER,
          minRequestIndex: 2,
        },
      ],
      setAsDefault: true,
    });

    const runnerLabel = `e2e-jira-agent-tools-${uniqueId}`;
    localRunner = await startSuiteLocalRunner({
      workspaceId: suite.workspaceId,
      userToken: suite.sessionToken,
      name: `E2E Jira agent tools ${uniqueId}`,
      runnerLabel,
      extraEnv: {
        ...fakeAnthropic.runnerEnv,
        SHIPFOX_POLL_MAX_DURATION_MS: String(JIRA_TERMINAL_TIMEOUT_MS),
      },
    });

    const {definition} = await seedProjectWithApiDefinition({
      suite,
      token: suite.sessionToken,
      name: 'jira-agent-tools',
      repo: `jira-agent-tools-${uniqueId}`,
      runnerLabel,
      workflowYaml: jiraToolsWorkflowYaml(connection.slug),
      configPath: '.shipfox/workflows/jira-agent-tools.yml',
    });
    const runId = await fireManualAndAwaitRun({
      client: createApiClient({token: suite.sessionToken}),
      definitionId: definition.id,
      inputs: {},
      scenario: 'jira-agent-tools',
    });
    const terminal = await waitForRunTerminalOrFailedRunner({
      runId,
      token: suite.sessionToken,
      timeoutMs: JIRA_TERMINAL_TIMEOUT_MS,
      runner: localRunner.runner,
      selection: {
        jobs: [{jobKey: 'tools', includeDefaultExecution: true, stepKeys: ['jira']}],
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
    expect(jiraApi.endpoint.toString()).toBe(
      new URL(process.env.JIRA_API_BASE_URL ?? 'http://invalid.local').toString(),
    );
    expect(jiraApi.calls).toEqual([
      {
        kind: 'get_issue',
        authorization: `Bearer ${accessToken}`,
        cloudId,
        idOrKey: issueKey,
        query: {},
      },
      {
        kind: 'add_comment',
        authorization: `Bearer ${accessToken}`,
        cloudId,
        idOrKey: issueKey,
        query: {},
        body: {
          body: {
            type: 'doc',
            version: 1,
            content: [{type: 'paragraph', content: [{type: 'text', text: replyText}]}],
          },
        },
      },
    ]);
    expect(jiraApi.writes().map(({kind, target}) => ({kind, target}))).toEqual([
      {kind: 'add_comment', target: issueKey},
    ]);
    const providerRequests = await fakeModelProvider.getRequests(scriptId);
    expect(providerRequests.some((request) => request.tools.includes(getIssueTool))).toBe(true);
    expect(providerRequests.some((request) => request.tools.includes(addCommentTool))).toBe(true);
    expect(providerRequests.every((request) => request.assertion_failures.length === 0)).toBe(true);
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
          `jira-agent-tools-e2e: stopFakeOpenAiModelProvider failed: ${String(error)}\n`,
        );
      }) ?? Promise.resolve(),
      jiraApi.stop().catch((error: unknown) => {
        process.stderr.write(`jira-agent-tools-e2e: stopJiraApiMock failed: ${String(error)}\n`);
      }),
      localRunner === undefined
        ? Promise.resolve()
        : stopLocalRunner(localRunner.runner).catch((error: unknown) => {
            process.stderr.write(
              `jira-agent-tools-e2e: stopLocalRunner failed: ${String(error)}\n`,
            );
          }),
    ]);
  }
});

function jiraToolsWorkflowYaml(connectionSlug: string): string {
  return `
name: Jira agent tools
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  tools:
    steps:
      - key: jira
        harness: claude
        provider: anthropic
        thinking: low
        prompt: Read the Jira issue and comment back.
        integrations:
          - connection: ${connectionSlug}
            include: [get_issue, add_comment]
            allow_write: true
`;
}
