import {createPrivateKey, randomUUID, sign} from 'node:crypto';
import {config} from '@shipfox/e2e-core';

const APPLICATION_COMMAND = 2;
const CHAT_INPUT_COMMAND = 1;
const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;

export interface DiscordSlashCommandParams {
  guildId: string;
  channelId: string;
  prompt: string;
  userId: string;
  /** The interaction ID, which is the delivery ID the API records. Defaults to a fresh one. */
  interactionId?: string | undefined;
}

export interface SignedDiscordInteraction {
  rawBody: string;
  headers: Record<string, string>;
}

export interface DiscordInteractionResponse {
  interactionId: string;
  status: number;
  body: unknown;
}

/**
 * Signs `timestamp + rawBody` as Discord does. Signing reads `E2E_DISCORD_PRIVATE_KEY`, the key
 * the E2E harness pairs with the API's `DISCORD_PUBLIC_KEY`.
 */
export function signDiscordInteraction(
  rawBody: string,
  timestamp = String(Math.floor(Date.now() / 1000)),
): SignedDiscordInteraction {
  const encodedKey = process.env.E2E_DISCORD_PRIVATE_KEY;
  if (!encodedKey) {
    throw new Error('E2E_DISCORD_PRIVATE_KEY must be configured for Discord interaction signing.');
  }
  const privateKey = createPrivateKey({
    key: Buffer.from(encodedKey, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  const signature = sign(null, Buffer.from(timestamp + rawBody), privateKey).toString('hex');
  return {
    rawBody,
    headers: {
      'content-type': 'application/json',
      'x-signature-ed25519': signature,
      'x-signature-timestamp': timestamp,
    },
  };
}

export function buildSlashCommandInteraction(params: DiscordSlashCommandParams) {
  return {
    id: params.interactionId ?? randomUUID(),
    application_id: process.env.DISCORD_APPLICATION_ID ?? 'e2e-discord-application-id',
    type: APPLICATION_COMMAND,
    token: `e2e-interaction-token-${randomUUID()}`,
    version: 1,
    guild_id: params.guildId,
    channel_id: params.channelId,
    channel: {id: params.channelId, type: 0},
    member: {user: {id: params.userId, username: 'e2e-discord-user'}},
    app_permissions: String(VIEW_CHANNEL | SEND_MESSAGES),
    data: {
      id: 'e2e-shipfox-command',
      name: 'shipfox',
      type: CHAT_INPUT_COMMAND,
      options: [{name: 'prompt', type: 3, value: params.prompt}],
    },
  };
}

/** Posts a signed `/shipfox prompt:` interaction and returns what Discord would show the user. */
export async function postDiscordSlashCommand(
  params: DiscordSlashCommandParams,
): Promise<DiscordInteractionResponse> {
  const interaction = buildSlashCommandInteraction(params);
  const {rawBody, headers} = signDiscordInteraction(JSON.stringify(interaction));
  const response = await fetch(
    new URL('/webhooks/integrations/discord/interactions', config.API_URL),
    {method: 'POST', body: rawBody, headers},
  );
  if (!response.ok) {
    throw new Error(`Signed Discord interaction delivery failed with ${response.status}.`);
  }
  return {interactionId: interaction.id, status: response.status, body: await response.json()};
}
