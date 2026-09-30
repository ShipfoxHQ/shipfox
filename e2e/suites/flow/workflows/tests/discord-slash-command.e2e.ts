import {stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {createDiscordConnection} from '@shipfox/e2e-setup-integrations';
import {attachLocalRunnerLog} from '#attachments.js';
import {triggerDiscordSlashCommandAndAwaitRun} from '#discord-events.js';
import {startSuiteLocalRunner, waitForRunTerminalOrFailedRunner} from '#runner.js';
import {seedProjectWithApiDefinition} from '#workflow-project.js';
import {expect, test} from './fixtures.js';

const TERMINAL_TIMEOUT_MS = 60_000;

test('starts a run from a signed /shipfox slash command', async ({suite}, testInfo) => {
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const scenario = 'discord-slash-command';
  const token = suite.sessionToken;
  const runnerLabel = `e2e-${scenario}-${uniqueId}`;
  const guildId = `guild-${uniqueId}`;
  const prompt = `ship it ${uniqueId}`;
  const connection = await createDiscordConnection({
    workspaceId: suite.workspaceId,
    guildId,
    guildName: `E2E Discord ${uniqueId}`,
  });
  const localRunner = await startSuiteLocalRunner({
    workspaceId: suite.workspaceId,
    userToken: token,
    name: `E2E ${scenario} ${uniqueId}`,
    runnerLabel,
    extraEnv: {SHIPFOX_POLL_MAX_DURATION_MS: String(TERMINAL_TIMEOUT_MS)},
  });

  try {
    // The trigger filters on this test's own prompt, so a run proves both the event name and that
    // the command's `prompt` option reached the filter.
    const {project} = await seedProjectWithApiDefinition({
      suite,
      token,
      name: scenario,
      repo: `${scenario}-${uniqueId}`,
      runnerLabel,
      workflowYaml: discordSlashCommandWorkflowYaml(prompt),
      configPath: `.shipfox/workflows/${scenario}.yml`,
      replacements: {__DISCORD_SOURCE__: connection.slug},
    });

    const triggered = await triggerDiscordSlashCommandAndAwaitRun({
      projectId: project.id,
      workspaceId: suite.workspaceId,
      token,
      guildId,
      channelId: `channel-${uniqueId}`,
      userId: `user-${uniqueId}`,
      prompt,
    });
    const terminal = await waitForRunTerminalOrFailedRunner({
      runId: triggered.runId,
      token,
      timeoutMs: TERMINAL_TIMEOUT_MS,
      runner: localRunner.runner,
    });

    expect(triggered.acknowledgement).toEqual({
      type: 4,
      data: {content: 'Working on it.', flags: 64},
    });
    expect(terminal.status).toBe('succeeded');
  } finally {
    await attachLocalRunnerLog(
      (attachment) =>
        testInfo.attach(attachment.name, {
          body: attachment.body,
          contentType: attachment.contentType,
        }),
      localRunner.logFile,
    );
    await stopLocalRunner(localRunner.runner).catch((error: unknown) => {
      process.stderr.write(`${scenario}-e2e: stopLocalRunner failed: ${String(error)}\n`);
    });
  }
});

function discordSlashCommandWorkflowYaml(prompt: string): string {
  return `
name: Discord slash command
runner: __RUNNER_LABEL__
triggers:
  on_slash_command:
    source: __DISCORD_SOURCE__
    event: slash_command
    filter: 'event.prompt == "${prompt}"'
jobs:
  handle:
    steps:
      - key: show
        run: echo "discord_slash_command_received"
`;
}
