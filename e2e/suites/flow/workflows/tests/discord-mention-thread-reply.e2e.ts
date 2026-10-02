import {startDiscordApiMock} from '@shipfox/e2e-driver-discord';
import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {createDiscordConnection} from '@shipfox/e2e-setup-integrations';
import {attachLocalRunnerLog} from '#attachments.js';
import {discordSnowflake, triggerDiscordMentionAndAwaitRun} from '#discord-events.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import {seedProjectWithApiDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const TERMINAL_TIMEOUT_MS = 60_000;

test('replies in a thread to a Discord mention with the read_thread and send_message tool steps', async ({
  suite,
}, testInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const scenario = 'discord-mention-thread-reply';
  const token = suite.sessionToken;
  const runnerLabel = `e2e-${scenario}-${uniqueId}`;
  const guildId = discordSnowflake();
  const channelId = discordSnowflake();
  const mention = `@Shipfox summarize ${uniqueId}`;
  const reply = `Replying in a thread ${uniqueId}`;
  const discordApi = await startDiscordApiMock();
  let localRunner: Awaited<ReturnType<typeof startSuiteLocalRunner>> | undefined;

  try {
    discordApi.addChannel({id: channelId, type: 0, guild_id: guildId, name: 'general'});
    const connection = await createDiscordConnection({
      workspaceId: suite.workspaceId,
      guildId,
      guildName: `E2E Discord ${uniqueId}`,
    });
    localRunner = await startSuiteLocalRunner({
      workspaceId: suite.workspaceId,
      userToken: token,
      name: `E2E ${scenario} ${uniqueId}`,
      runnerLabel,
      extraEnv: {SHIPFOX_POLL_MAX_DURATION_MS: String(TERMINAL_TIMEOUT_MS)},
    });

    const {project} = await seedProjectWithApiDefinition({
      suite,
      token,
      name: scenario,
      repo: `${scenario}-${uniqueId}`,
      runnerLabel,
      workflowYaml: discordMentionWorkflowYaml({slug: connection.slug, mention, reply}),
      configPath: `.shipfox/workflows/${scenario}.yml`,
    });

    const triggered = await triggerDiscordMentionAndAwaitRun({
      discordApi,
      connectionId: connection.id,
      projectId: project.id,
      workspaceId: suite.workspaceId,
      token,
      channelId,
      authorId: discordSnowflake(),
      content: mention,
    });
    const terminal = await waitForRunTerminalOrFailedRunner({
      runId: triggered.runId,
      token,
      timeoutMs: TERMINAL_TIMEOUT_MS,
      runner: localRunner.runner,
      selection: {
        jobs: [
          {
            jobKey: 'reply',
            includeDefaultExecution: true,
            stepKeys: ['read_thread', 'send_message', 'verify'],
          },
        ],
      },
    });

    expect(terminal.status).toBe('succeeded');
    const steps = terminal.jobs.find((job) => job.key === 'reply')?.executions[0]?.steps ?? [];
    expect(Object.fromEntries(steps.map((step) => [step.key, step.status]))).toEqual({
      read_thread: 'succeeded',
      send_message: 'succeeded',
      verify: 'succeeded',
    });
    // A thread started from a message has that message's ID, and the reply is in it, not the channel.
    expect(discordApi.writes()).toEqual([
      {
        kind: 'create_thread',
        target: `${channelId}/${triggered.messageId}`,
        payload: {name: mention},
      },
      {kind: 'create_message', target: triggered.messageId, payload: {content: reply}},
    ]);
    expect(discordApi.messages(triggered.messageId).map((message) => message.content)).toEqual([
      reply,
    ]);
    expect(discordApi.calls.every((call) => call.authorization === `Bot ${botToken()}`)).toBe(true);
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
      discordApi.stop().catch((error: unknown) => {
        process.stderr.write(`${scenario}-e2e: stopDiscordApiMock failed: ${String(error)}\n`);
      }),
      localRunner === undefined
        ? Promise.resolve()
        : stopLocalRunner(localRunner.runner).catch((error: unknown) => {
            process.stderr.write(`${scenario}-e2e: stopLocalRunner failed: ${String(error)}\n`);
          }),
    ]);
  }
});

function botToken(): string {
  return process.env.DISCORD_BOT_TOKEN ?? 'e2e-discord-bot-token';
}

function discordMentionWorkflowYaml(params: {
  slug: string;
  mention: string;
  reply: string;
}): string {
  return `
name: Discord mention
runner: __RUNNER_LABEL__
triggers:
  on_mention:
    source: ${params.slug}
    event: message_create
    filter: 'event.mentions_bot && event.content == "${params.mention}"'
jobs:
  reply:
    steps:
      - key: read_thread
        tool: read_thread
        connection: ${params.slug}
        with:
          channel_id: '\${{ event.channel_id }}'
          message_id: '\${{ event.id }}'
        outputs:
          mention: '\${{ result.messages[0].content }}'
      - key: send_message
        tool: send_message
        connection: ${params.slug}
        with:
          channel_id: '\${{ event.channel_id }}'
          thread_message_id: '\${{ event.id }}'
          message: '${params.reply}'
      - key: verify
        env:
          MENTION: '\${{ steps.read_thread.outputs.mention }}'
        run: |
          test "$MENTION" = "${params.mention}"
`;
}
