import {
  type DiscordApiMock,
  type DiscordSlashCommandParams,
  injectDiscordMessageCreate,
  postDiscordSlashCommand,
} from '@shipfox/e2e-driver-discord';
import {waitForRunByDeliveryId} from '@shipfox/e2e-observe-workflows';

const MAX_TRIGGER_ATTEMPTS = 8;
const RUN_LOOKUP_TIMEOUT_MS = 15_000;

export async function triggerDiscordSlashCommandAndAwaitRun(
  params: DiscordSlashCommandParams & {
    projectId: string;
    workspaceId: string;
    token: string;
  },
): Promise<{runId: string; interactionId: string; acknowledgement: unknown}> {
  let lastError: unknown;

  // An interaction that lands before the definition's subscription activates starts no run, so the
  // sender retries, each time as a new interaction, until one appears.
  for (let attempt = 1; attempt <= MAX_TRIGGER_ATTEMPTS; attempt += 1) {
    const {interactionId, body} = await postDiscordSlashCommand({
      guildId: params.guildId,
      channelId: params.channelId,
      prompt: params.prompt,
      userId: params.userId,
    });

    try {
      const run = await waitForRunByDeliveryId({
        projectId: params.projectId,
        deliveryId: interactionId,
        token: params.token,
        timeoutMs: RUN_LOOKUP_TIMEOUT_MS,
        workspaceId: params.workspaceId,
      });
      return {runId: run.id, interactionId, acknowledgement: body};
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`No run appeared after ${MAX_TRIGGER_ATTEMPTS} signed Discord interactions.`);
}

/** A numeric ID of up to 20 digits, which is what the Discord tools accept. */
export function discordSnowflake(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0')}`;
}

export async function triggerDiscordMentionAndAwaitRun(params: {
  discordApi: DiscordApiMock;
  connectionId: string;
  projectId: string;
  workspaceId: string;
  token: string;
  channelId: string;
  authorId: string;
  content: string;
}): Promise<{runId: string; messageId: string}> {
  let lastError: unknown;

  // A message that lands before the definition's subscription activates starts no run, so the
  // sender retries, each time as a new message, until one appears.
  for (let attempt = 1; attempt <= MAX_TRIGGER_ATTEMPTS; attempt += 1) {
    const messageId = discordSnowflake();
    // The tools read the message back from Discord, so it has to exist there before it is delivered.
    params.discordApi.addMessage({
      id: messageId,
      channel_id: params.channelId,
      content: params.content,
      author: {id: params.authorId, username: 'e2e-discord-user'},
    });
    await injectDiscordMessageCreate({
      connectionId: params.connectionId,
      channelId: params.channelId,
      messageId,
      content: params.content,
      authorId: params.authorId,
    });

    try {
      const run = await waitForRunByDeliveryId({
        projectId: params.projectId,
        deliveryId: messageId,
        token: params.token,
        timeoutMs: RUN_LOOKUP_TIMEOUT_MS,
        workspaceId: params.workspaceId,
      });
      return {runId: run.id, messageId};
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`No run appeared after ${MAX_TRIGGER_ATTEMPTS} injected Discord messages.`);
}
