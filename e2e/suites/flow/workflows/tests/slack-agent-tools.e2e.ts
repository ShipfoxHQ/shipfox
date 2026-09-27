import {createApiClient} from '@shipfox/e2e-core';
import {message, startFakeOpenAiModelProvider, toolCall} from '@shipfox/e2e-driver-model-provider';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {createAnthropicFakeModelProviderConfig} from '@shipfox/e2e-setup-agent';
import {createSlackConnection} from '@shipfox/e2e-setup-integrations';
import {
  failingWorkflowYaml,
  REPORT_FAILURE_MARKER,
  reportFailedRunsWorkflowYaml,
  waitForReportRun,
} from '#report-failed-runs.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import {runSlackToolsWorkflow} from '#slack-agent-tools.js';
import {SLACK_REPLIES_MARKER, type SlackApiMockCall, startSlackApiMock} from '#slack-api.js';
import {fireManualAndAwaitRun} from '#triggers.js';
import {seedProjectWithApiDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const CLAUDE_AGENT_MODEL = 'deterministic-slack-tools-agent';
const SLACK_BOT_TOKEN = 'xoxb-e2e-slack-bot-token';
const REPORT_TIMEOUT_MS = 120_000;
// A failure before the report's subscription activates starts no report, so the test fails again.
const REPORT_WAIT_MS = 20_000;
const MAX_FAILURE_ATTEMPTS = 5;
const REPORT_CHANNEL = 'C0REPORTE2E';
const FAILING_PATH = '.shipfox/workflows/always-fails.yml';
const REPORT_PATH = '.shipfox/workflows/report-failed-runs.yml';

// The API calls one Slack API mock address, so Slack tests share its port and run serially.
test.describe.configure({mode: 'serial'});

test('starts a run from a signed Slack mention and calls Slack agent tools', async ({
  suite,
}, testInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const teamId = `T${uniqueId}`;
  const channel = `C${uniqueId}`;
  const threadTs = '1721300000.000001';
  const replyText = 'I read the Slack thread.';
  const slackApi = await startSlackApiMock();
  let fakeModelProvider: Awaited<ReturnType<typeof startFakeOpenAiModelProvider>> | undefined;

  try {
    const scriptId = `${suite.runId}-slack-agent-tools-${uniqueId}`;
    fakeModelProvider = await startFakeOpenAiModelProvider({runId: scriptId});
    const connection = await createSlackConnection({
      workspaceId: suite.workspaceId,
      teamId,
      teamName: `E2E Slack ${uniqueId}`,
      appId: `A${uniqueId}`,
      botUserId: `Ubot${uniqueId}`,
      botToken: SLACK_BOT_TOKEN,
      scopes: ['app_mentions:read', 'channels:history', 'chat:write'],
    });
    const repliesTool = `mcp__shipfox_integration_tools__${connection.slug}__read_thread`;
    const postMessageTool = `mcp__shipfox_integration_tools__${connection.slug}__send_message`;
    const fakeAnthropic = await createAnthropicFakeModelProviderConfig({
      workspaceId: suite.workspaceId,
      fakeModelProvider,
      scriptId,
      model: CLAUDE_AGENT_MODEL,
      responses: [
        toolCall(repliesTool, {channel_id: channel, message_ts: threadTs}),
        toolCall(postMessageTool, {channel_id: channel, thread_ts: threadTs, message: replyText}),
        message('done'),
      ],
      assertions: [
        {kind: 'model', equals: CLAUDE_AGENT_MODEL},
        {kind: 'tool_present', name: repliesTool},
        {kind: 'tool_present', name: postMessageTool},
        {
          kind: 'message_content_includes',
          value: SLACK_REPLIES_MARKER,
          minRequestIndex: 1,
        },
      ],
      setAsDefault: true,
    });

    const {terminal} = await runSlackToolsWorkflow({
      suite,
      attach: (name, options) => testInfo.attach(name, options),
      uniqueId,
      connectionSlug: connection.slug,
      runnerEnv: fakeAnthropic.runnerEnv,
      botUserId: `Ubot${uniqueId}`,
      teamId,
      channel,
      threadTs,
    });

    expect(terminal.status).toBe('succeeded');
    expect(terminal.jobs.find((job) => job.key === 'tools')?.status).toBe('succeeded');
    expect(slackApi.endpoint.toString()).toBe(
      new URL(process.env.SLACK_API_BASE_URL ?? 'http://invalid.local').toString(),
    );
    expect(slackApi.calls).toEqual([
      {
        kind: 'conversations.replies',
        authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        channel,
        ts: threadTs,
      },
      {
        kind: 'chat.postMessage',
        authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        channel,
        threadTs,
        text: replyText,
      },
    ]);
    const providerRequests = await fakeModelProvider.getRequests(scriptId);
    expect(providerRequests.some((request) => request.tools.includes(repliesTool))).toBe(true);
    expect(providerRequests.some((request) => request.tools.includes(postMessageTool))).toBe(true);
    expect(providerRequests.every((request) => request.assertion_failures.length === 0)).toBe(true);
  } finally {
    await Promise.all([
      fakeModelProvider?.stop()?.catch((error: unknown) => {
        process.stderr.write(
          `slack-agent-tools-e2e: stopFakeOpenAiModelProvider failed: ${String(error)}\n`,
        );
      }) ?? Promise.resolve(),
      slackApi.stop().catch((error: unknown) => {
        process.stderr.write(`slack-agent-tools-e2e: stopSlackApiMock failed: ${String(error)}\n`);
      }),
    ]);
  }
});

test('reports a failed run to Slack from its run.completed event', async ({suite}) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const token = suite.sessionToken;
  const client = createApiClient({token});
  const slackApi = await startSlackApiMock();
  const runnerLabel = `e2e-report-failed-runs-${uniqueId}`;
  let localRunner: Awaited<ReturnType<typeof startSuiteLocalRunner>> | undefined;

  // A retried failure can still produce a late report, so count posts per failed run.
  const postsFor = (runId: string) =>
    slackApi.calls.filter(isPostMessage).filter((call) => call.text?.includes(`/runs/${runId}`));
  const waitForTerminal = async (runId: string) => {
    if (localRunner === undefined) throw new Error('The local runner did not start');
    return await waitForRunTerminalOrFailedRunner({
      runId,
      token,
      timeoutMs: REPORT_TIMEOUT_MS,
      runner: localRunner.runner,
    });
  };

  try {
    const connection = await createSlackConnection({
      workspaceId: suite.workspaceId,
      teamId: `T${uniqueId}`,
      teamName: `E2E Slack ${uniqueId}`,
      appId: `A${uniqueId}`,
      botUserId: `U${uniqueId}`,
      botToken: `xoxb-report-failed-runs-${uniqueId}`,
    });
    localRunner = await startSuiteLocalRunner({
      workspaceId: suite.workspaceId,
      userToken: token,
      name: `E2E failed run report ${uniqueId}`,
      runnerLabel,
    });
    const {definition, project} = await seedProjectWithApiDefinition({
      suite,
      token,
      name: 'report-failed-runs',
      repo: `report-failed-runs-${uniqueId}`,
      runnerLabel,
      workflowYaml: failingWorkflowYaml(),
      configPath: FAILING_PATH,
      // Workflow identity comes from the config path; the report skips its own workflow.
      repositoryBacked: true,
      additionalDefinitions: [
        {
          configPath: REPORT_PATH,
          workflowYaml: reportFailedRunsWorkflowYaml({
            slackSlug: connection.slug,
            channel: REPORT_CHANNEL,
            workflowPaths: [FAILING_PATH, REPORT_PATH],
          }),
        },
      ],
    });
    const failAndAwaitReport = async () => {
      for (let attempt = 1; attempt <= MAX_FAILURE_ATTEMPTS; attempt += 1) {
        const failedRunId = await fireManualAndAwaitRun({
          client,
          definitionId: definition.id,
          inputs: {},
          scenario: 'always-fails',
        });
        const failed = await waitForTerminal(failedRunId);
        expect(failed.status).toBe('failed');
        try {
          const reportRunId = await waitForReportRun({
            client,
            projectId: project.id,
            name: `Report Always fails #${failed.number}`,
            timeoutMs: REPORT_WAIT_MS,
          });
          return {failedRunId, reportRunId};
        } catch (error) {
          if (attempt === MAX_FAILURE_ATTEMPTS) throw error;
        }
      }
      throw new Error('No report run started');
    };

    const first = await failAndAwaitReport();
    const firstReport = await waitForTerminal(first.reportRunId);

    expect(firstReport.status).toBe('succeeded');
    expect(postsFor(first.failedRunId)).toHaveLength(1);
    expect(postsFor(first.failedRunId)[0]).toMatchObject({
      authorization: `Bearer xoxb-report-failed-runs-${uniqueId}`,
      channel: REPORT_CHANNEL,
    });
    expect(postsFor(first.failedRunId)[0]?.text).toContain('Failed: fail › Fail on purpose');
    expect(postsFor(first.failedRunId)[0]?.text).toContain(REPORT_FAILURE_MARKER);

    slackApi.setPostMessageError('channel_not_found');
    const second = await failAndAwaitReport();
    const undelivered = await waitForTerminal(second.reportRunId);
    const selfReportRunId = await waitForReportRun({
      client,
      projectId: project.id,
      name: `Report Report failed Shipfox workflow runs #${undelivered.number}`,
      timeoutMs: REPORT_WAIT_MS,
    });
    const selfReport = await waitForTerminal(selfReportRunId);
    slackApi.setPostMessageError(null);
    await client.requestJson('post', `/workflows/runs/${second.reportRunId}/rerun`, {
      json: {mode: 'failed'},
    });
    const redelivered = await waitForTerminal(second.reportRunId);

    expect(undelivered.status).toBe('failed');
    expect(selfReport.status).toBe('succeeded');
    expect(selfReport.jobs.find((job) => job.key === 'report')?.status).toBe('skipped');
    expect(redelivered.status).toBe('succeeded');
    expect(postsFor(second.reportRunId)).toEqual([]);
    const secondPosts = postsFor(second.failedRunId);
    expect(secondPosts).toHaveLength(2);
    expect(secondPosts[1]?.text).toBe(secondPosts[0]?.text);
  } finally {
    await Promise.all([
      slackApi.stop().catch((error: unknown) => {
        process.stderr.write(`report-failed-runs-e2e: stopSlackApiMock failed: ${String(error)}\n`);
      }),
      localRunner === undefined
        ? Promise.resolve()
        : stopLocalRunner(localRunner.runner).catch((error: unknown) => {
            process.stderr.write(
              `report-failed-runs-e2e: stopLocalRunner failed: ${String(error)}\n`,
            );
          }),
    ]);
  }
});

function isPostMessage(
  call: SlackApiMockCall,
): call is Extract<SlackApiMockCall, {kind: 'chat.postMessage'}> {
  return call.kind === 'chat.postMessage';
}
