import {generateKeyPairSync, randomUUID, sign} from 'node:crypto';
import type {IntegrationConnection, StoredWebhookRequest} from '@shipfox/api-integration-spi';
import {createStoredWebhookRequest} from '@shipfox/api-integration-spi';

export const APPLICATION_ID = 'app-1';
export const GUILD_ID = 'guild-1';
export const BOT_ROLE_ID = 'role-bot';
export const CAN_POST_PERMISSIONS = String((1n << 10n) | (1n << 11n));

export interface DiscordSigner {
  publicKey: string;
  signBody(input: {rawBody: string; timestamp: string}): string;
}

export function createDiscordSigner(): DiscordSigner {
  const {publicKey, privateKey} = generateKeyPairSync('ed25519');
  const rawPublicKey = publicKey.export({format: 'der', type: 'spki'}).subarray(-32);
  return {
    publicKey: rawPublicKey.toString('hex'),
    signBody: ({rawBody, timestamp}) =>
      sign(null, Buffer.from(timestamp + rawBody), privateKey).toString('hex'),
  };
}

export function nowSeconds(offsetSeconds = 0): string {
  return String(Math.floor(Date.now() / 1000) + offsetSeconds);
}

export function fakeConnection(
  overrides: Partial<IntegrationConnection> = {},
): IntegrationConnection {
  return {
    id: randomUUID(),
    workspaceId: randomUUID(),
    provider: 'discord',
    externalAccountId: GUILD_ID,
    slug: 'discord_acme',
    displayName: 'Acme Discord',
    lifecycleStatus: 'active',
    repositoryAccessMode: 'selected',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function pingInteraction(): Record<string, unknown> {
  return {id: 'ping-1', application_id: APPLICATION_ID, type: 1, token: 'secret-token', version: 1};
}

const member = {user: {id: 'user-1', username: 'ada'}};

export function slashInteraction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `interaction-${randomUUID()}`,
    application_id: APPLICATION_ID,
    type: 2,
    token: 'secret-token',
    version: 1,
    guild_id: GUILD_ID,
    channel_id: 'channel-1',
    channel: {id: 'channel-1', type: 0},
    member,
    app_permissions: CAN_POST_PERMISSIONS,
    data: {
      id: 'command-1',
      name: 'shipfox',
      type: 1,
      options: [{name: 'prompt', type: 3, value: 'ship it'}],
    },
    ...overrides,
  };
}

export function messageCommandInteraction(
  overrides: Record<string, unknown> = {},
  message: Record<string, unknown> = {},
): Record<string, unknown> {
  return slashInteraction({
    data: {
      id: 'command-2',
      name: 'Send to Shipfox',
      type: 3,
      target_id: 'message-1',
      resolved: {
        messages: {
          'message-1': {
            id: 'message-1',
            channel_id: 'channel-1',
            content: 'deploy is stuck',
            author: {id: 'user-2', username: 'grace'},
            mentions: [],
            mention_roles: [],
            ...message,
          },
        },
      },
    },
    ...overrides,
  });
}

export function signedInteractionRequest(input: {
  signer: DiscordSigner;
  interaction: Record<string, unknown>;
  receivedAt?: string | undefined;
  timestamp?: string | undefined;
  signature?: string | undefined;
  omitHeaders?: readonly ('x-signature-ed25519' | 'x-signature-timestamp')[] | undefined;
}): StoredWebhookRequest {
  const rawBody = JSON.stringify(input.interaction);
  const timestamp = input.timestamp ?? nowSeconds();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-signature-ed25519': input.signature ?? input.signer.signBody({rawBody, timestamp}),
    'x-signature-timestamp': timestamp,
  };
  for (const name of input.omitHeaders ?? []) delete headers[name];
  return createStoredWebhookRequest({
    requestId: randomUUID(),
    routeId: 'discord.interaction',
    receivedAt: input.receivedAt ?? new Date().toISOString(),
    rawQueryString: '',
    headers,
    body: Buffer.from(rawBody),
  });
}
