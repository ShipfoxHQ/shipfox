import {randomUUID} from 'node:crypto';
import {request} from '@shipfox/e2e-core';

export interface DiscordMessageCreateParams {
  /** The connection of the server the message is in, made with `createDiscordConnection`. */
  connectionId: string;
  channelId: string;
  /** A numeric ID, as Discord's are. The API records it as the delivery ID. */
  messageId: string;
  content: string;
  authorId: string;
  /** Whether the message mentions the bot user. Defaults to true. */
  mentionsBot?: boolean | undefined;
}

export function buildMessageCreate(params: DiscordMessageCreateParams) {
  const botUserId = process.env.DISCORD_APPLICATION_ID ?? 'e2e-discord-application-id';
  return {
    id: params.messageId,
    channel_id: params.channelId,
    content: params.content,
    author: {id: params.authorId, username: 'e2e-discord-user'},
    mentions: params.mentionsBot === false ? [] : [{id: botUserId, username: 'Shipfox', bot: true}],
    mention_roles: [],
    timestamp: new Date().toISOString(),
    type: 0,
  };
}

/**
 * Stands in for the Discord Gateway delivering a message. The API runs it through the handler the
 * Gateway service uses, because the E2E stack does not connect to Discord.
 */
export async function injectDiscordMessageCreate(
  params: DiscordMessageCreateParams,
): Promise<void> {
  await request('post', '/__e2e/integrations/discord-dispatches', {
    json: {
      connection_id: params.connectionId,
      session_id: `e2e-session-${randomUUID()}`,
      dispatch: {t: 'MESSAGE_CREATE', d: buildMessageCreate(params)},
    },
  });
}
