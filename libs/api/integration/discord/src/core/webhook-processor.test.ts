import {randomUUID} from 'node:crypto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {db} from '#db/db.js';
import {upsertDiscordInstallation} from '#db/installations.js';
import {discordInstallations} from '#db/schema/installations.js';
import {
  APPLICATION_ID,
  BOT_ROLE_ID,
  CAN_POST_PERMISSIONS,
  createDiscordSigner,
  fakeConnection,
  GUILD_ID,
  messageCommandInteraction,
  nowSeconds,
  pingInteraction,
  signedInteractionRequest,
  slashInteraction,
} from '#test/index.js';
import {
  DISCORD_ACK_CANNOT_POST,
  DISCORD_ACK_NOT_CONNECTED,
  DISCORD_ACK_UNSUPPORTED,
  DISCORD_ACK_WORKING,
} from './interactions.js';
import {createDiscordWebhookProcessor} from './webhook-processor.js';

const signer = createDiscordSigner();

function ephemeral(content: string) {
  return {type: 4, data: {content, flags: 64}};
}

async function arrange(
  options: {
    connection?: IntegrationConnection | undefined;
    installed?: boolean;
    published?: boolean;
  } = {},
) {
  const connection = options.connection ?? fakeConnection();
  if (options.installed !== false) {
    await upsertDiscordInstallation({
      connectionId: connection.id,
      guildId: GUILD_ID,
      guildName: 'Acme',
      permissions: '0',
      botRoleId: BOT_ROLE_ID,
      status: 'installed',
    });
  }
  const publishIntegrationEventReceived = vi.fn(() =>
    Promise.resolve({published: options.published ?? true}),
  );
  const recordDeliveryOnly = vi.fn(() => Promise.resolve());
  const processor = createDiscordWebhookProcessor({
    coreDb: db,
    publicKey: signer.publicKey,
    publishIntegrationEventReceived,
    recordDeliveryOnly,
    getIntegrationConnectionById: vi.fn(() => Promise.resolve(connection)),
  });
  return {connection, processor, publishIntegrationEventReceived, recordDeliveryOnly};
}

describe('Discord webhook processor', () => {
  beforeEach(async () => {
    await db().delete(discordInstallations);
  });

  describe('signature', () => {
    it.each([
      ['x-signature-ed25519' as const],
      ['x-signature-timestamp' as const],
    ])('discards a request missing %s', async (header) => {
      const {processor, publishIntegrationEventReceived} = await arrange();

      const {result, response} = await processor.processInteraction(
        signedInteractionRequest({
          signer,
          interaction: slashInteraction(),
          omitHeaders: [header],
        }),
      );

      expect(result).toEqual({outcome: 'discarded', reason: 'missing_required_input'});
      expect(response).toBeUndefined();
      expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    });

    it('discards a request signed by another key', async () => {
      const {processor, publishIntegrationEventReceived} = await arrange();

      const {result} = await processor.processInteraction(
        signedInteractionRequest({
          signer: createDiscordSigner(),
          interaction: slashInteraction(),
        }),
      );

      expect(result).toEqual({outcome: 'discarded', reason: 'invalid_signature'});
      expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    });

    it('discards a request whose signature is not a valid Ed25519 signature', async () => {
      const {processor} = await arrange();

      const {result} = await processor.processInteraction(
        signedInteractionRequest({
          signer,
          interaction: slashInteraction(),
          signature: 'not-a-signature',
        }),
      );

      expect(result).toEqual({outcome: 'discarded', reason: 'invalid_signature'});
    });

    it('discards a body signed for another timestamp', async () => {
      const {processor} = await arrange();
      const interaction = slashInteraction();
      const signature = signer.signBody({
        rawBody: JSON.stringify(interaction),
        timestamp: nowSeconds(-1),
      });

      const {result} = await processor.processInteraction(
        signedInteractionRequest({signer, interaction, timestamp: nowSeconds(), signature}),
      );

      expect(result).toEqual({outcome: 'discarded', reason: 'invalid_signature'});
    });
  });

  describe('freshness', () => {
    it.each([
      ['inside the window before receipt', -299],
      ['inside the window after receipt', 299],
    ])('accepts a timestamp %s', async (_name, offsetSeconds) => {
      const receivedAt = new Date();
      const {processor, publishIntegrationEventReceived} = await arrange();

      const {result} = await processor.processInteraction(
        signedInteractionRequest({
          signer,
          interaction: slashInteraction(),
          receivedAt: receivedAt.toISOString(),
          timestamp: String(Math.floor(receivedAt.getTime() / 1000) + offsetSeconds),
        }),
      );

      expect(result.outcome).toBe('processed');
      expect(publishIntegrationEventReceived).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['past the window before receipt', -301],
      ['ahead of receipt beyond the window', 301],
    ])('discards a timestamp %s', async (_name, offsetSeconds) => {
      const receivedAt = new Date();
      const {processor, publishIntegrationEventReceived} = await arrange();

      const {result, response} = await processor.processInteraction(
        signedInteractionRequest({
          signer,
          interaction: slashInteraction(),
          receivedAt: receivedAt.toISOString(),
          timestamp: String(Math.floor(receivedAt.getTime() / 1000) + offsetSeconds),
        }),
      );

      expect(result).toEqual({outcome: 'discarded', reason: 'stale_at_receipt'});
      expect(response).toBeUndefined();
      expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    });

    it('measures the window from receipt, not from processing time', async () => {
      const receivedAt = new Date(Date.now() - 60 * 60_000);
      const {processor} = await arrange();

      const {result} = await processor.processInteraction(
        signedInteractionRequest({
          signer,
          interaction: slashInteraction(),
          receivedAt: receivedAt.toISOString(),
          timestamp: String(Math.floor(receivedAt.getTime() / 1000)),
        }),
      );

      expect(result.outcome).toBe('processed');
    });

    it('rejects a replay after the delivery record expired and publishes nothing', async () => {
      const {processor, publishIntegrationEventReceived} = await arrange();
      const captured = slashInteraction();
      const capturedAt = new Date(Date.now() - 31 * 24 * 60 * 60_000);
      const capturedTimestamp = String(Math.floor(capturedAt.getTime() / 1000));

      // The same signed bytes, replayed now: the dedupe record is gone but the signature holds.
      const {result} = await processor.processInteraction(
        signedInteractionRequest({
          signer,
          interaction: captured,
          timestamp: capturedTimestamp,
        }),
      );

      expect(result).toEqual({outcome: 'discarded', reason: 'stale_at_receipt'});
      expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    });
  });

  describe('payload', () => {
    it('discards a body that is not JSON', async () => {
      const {processor} = await arrange();
      const request = signedInteractionRequest({signer, interaction: {}});
      const rawBody = 'not json';
      const timestamp = nowSeconds();
      const {createStoredWebhookRequest} = await import('@shipfox/api-integration-spi');

      const {result} = await processor.processInteraction(
        createStoredWebhookRequest({
          requestId: randomUUID(),
          routeId: 'discord.interaction',
          receivedAt: request.received_at,
          rawQueryString: '',
          headers: {
            'x-signature-ed25519': signer.signBody({rawBody, timestamp}),
            'x-signature-timestamp': timestamp,
          },
          body: Buffer.from(rawBody),
        }),
      );

      expect(result).toEqual({outcome: 'discarded', reason: 'malformed_payload'});
    });

    it('discards an interaction missing required fields', async () => {
      const {processor} = await arrange();

      const {result} = await processor.processInteraction(
        signedInteractionRequest({signer, interaction: {type: 2}}),
      );

      expect(result).toEqual({outcome: 'discarded', reason: 'malformed_payload'});
    });
  });

  describe('PING', () => {
    it('answers with a PONG and touches no connection', async () => {
      const {processor, publishIntegrationEventReceived, recordDeliveryOnly} = await arrange({
        installed: false,
      });

      const {result, response} = await processor.processInteraction(
        signedInteractionRequest({signer, interaction: pingInteraction()}),
      );

      expect(result).toEqual({outcome: 'processed'});
      expect(response).toEqual({type: 1});
      expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
      expect(recordDeliveryOnly).not.toHaveBeenCalled();
    });
  });

  describe('commands', () => {
    it('publishes slash_command with the interaction id and without the token', async () => {
      const interaction = slashInteraction({
        channel_id: 'thread-1',
        channel: {id: 'thread-1', type: 11, parent_id: 'forum-1'},
      });
      const {connection, processor, publishIntegrationEventReceived} = await arrange();

      const {result, response} = await processor.processInteraction(
        signedInteractionRequest({signer, interaction}),
      );

      expect(result).toEqual({outcome: 'processed', deliveryId: interaction.id});
      expect(response).toEqual(ephemeral(DISCORD_ACK_WORKING));
      expect(publishIntegrationEventReceived).toHaveBeenCalledTimes(1);
      const [{event}] = publishIntegrationEventReceived.mock.calls[0] as unknown as [
        {event: Record<string, unknown>},
      ];
      expect(event).toMatchObject({
        provider: 'discord',
        source: connection.slug,
        event: 'slash_command',
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        deliveryId: interaction.id,
        payload: {
          id: interaction.id,
          prompt: 'ship it',
          root_channel_id: 'forum-1',
          author: {id: 'user-1', username: 'ada', bot: false},
        },
      });
      expect(event.payload).not.toHaveProperty('token');
    });

    it('publishes message_command with the normalized target message', async () => {
      const interaction = messageCommandInteraction(
        {},
        {
          mentions: [{id: APPLICATION_ID, bot: true}],
          author: {id: 'user-2', username: 'grace', bot: true},
        },
      );
      const {processor, publishIntegrationEventReceived} = await arrange();

      const {result, response} = await processor.processInteraction(
        signedInteractionRequest({signer, interaction}),
      );

      expect(result).toEqual({outcome: 'processed', deliveryId: interaction.id});
      expect(response).toEqual(ephemeral(DISCORD_ACK_WORKING));
      const [{event}] = publishIntegrationEventReceived.mock.calls[0] as unknown as [
        {event: Record<string, unknown>},
      ];
      expect(event).toMatchObject({
        event: 'message_command',
        payload: {
          root_channel_id: 'channel-1',
          target_message: {
            id: 'message-1',
            mentions_bot: true,
            author: {id: 'user-2', bot: true},
            url: `https://discord.com/channels/${GUILD_ID}/channel-1/message-1`,
            root_channel_id: 'channel-1',
          },
        },
      });
      expect(event.payload).not.toHaveProperty('token');
    });

    it('marks the target as mentioning the bot through its managed role', async () => {
      const {processor, publishIntegrationEventReceived} = await arrange();

      await processor.processInteraction(
        signedInteractionRequest({
          signer,
          interaction: messageCommandInteraction({}, {mention_roles: [BOT_ROLE_ID]}),
        }),
      );

      const [{event}] = publishIntegrationEventReceived.mock.calls[0] as unknown as [
        {event: {payload: {target_message: {mentions_bot: boolean}}}},
      ];
      expect(event.payload.target_message.mentions_bot).toBe(true);
    });

    it('reports a duplicate interaction and still acknowledges it', async () => {
      const interaction = slashInteraction();
      const {processor} = await arrange({published: false});

      const {result, response} = await processor.processInteraction(
        signedInteractionRequest({signer, interaction}),
      );

      expect(result).toEqual({outcome: 'duplicate', deliveryId: interaction.id});
      expect(response).toEqual(ephemeral(DISCORD_ACK_WORKING));
    });
  });

  describe('acknowledgement', () => {
    it('says the server is not connected for an unknown guild, recording the delivery only', async () => {
      const interaction = slashInteraction();
      const {processor, publishIntegrationEventReceived, recordDeliveryOnly} = await arrange({
        installed: false,
      });

      const {result, response} = await processor.processInteraction(
        signedInteractionRequest({signer, interaction}),
      );

      expect(result).toEqual({
        outcome: 'discarded',
        reason: 'connection_unavailable',
        deliveryId: interaction.id,
      });
      expect(response).toEqual(ephemeral(DISCORD_ACK_NOT_CONNECTED));
      expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
      expect(recordDeliveryOnly).toHaveBeenCalledWith(
        expect.objectContaining({provider: 'discord', deliveryId: interaction.id}),
      );
    });

    it('says the server is not connected when the connection is not active', async () => {
      const {processor, publishIntegrationEventReceived} = await arrange({
        connection: fakeConnection({lifecycleStatus: 'error'}),
      });

      const {response} = await processor.processInteraction(
        signedInteractionRequest({signer, interaction: slashInteraction()}),
      );

      expect(response).toEqual(ephemeral(DISCORD_ACK_NOT_CONNECTED));
      expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    });

    it('says the server is not connected when the installation was removed', async () => {
      const connection = fakeConnection();
      const {processor} = await arrange({connection});
      await upsertDiscordInstallation({
        connectionId: connection.id,
        guildId: GUILD_ID,
        guildName: 'Acme',
        permissions: '0',
        status: 'removed',
      });

      const {response} = await processor.processInteraction(
        signedInteractionRequest({signer, interaction: slashInteraction()}),
      );

      expect(response).toEqual(ephemeral(DISCORD_ACK_NOT_CONNECTED));
    });

    it.each([
      ['VIEW_CHANNEL', String(1n << 11n)],
      ['SEND_MESSAGES', String(1n << 10n)],
      ['both', '0'],
      ['app_permissions', undefined],
    ])('warns that replies may not appear without %s but still publishes', async (_name, permissions) => {
      const interaction = slashInteraction({app_permissions: permissions});
      const {processor, publishIntegrationEventReceived} = await arrange();

      const {result, response} = await processor.processInteraction(
        signedInteractionRequest({signer, interaction}),
      );

      expect(result.outcome).toBe('processed');
      expect(response).toEqual(ephemeral(DISCORD_ACK_CANNOT_POST));
      expect(publishIntegrationEventReceived).toHaveBeenCalledTimes(1);
    });

    it('acknowledges with working when the bot can view and post', async () => {
      const {processor} = await arrange();

      const {response} = await processor.processInteraction(
        signedInteractionRequest({
          signer,
          interaction: slashInteraction({app_permissions: CAN_POST_PERMISSIONS}),
        }),
      );

      expect(response).toEqual(ephemeral(DISCORD_ACK_WORKING));
    });

    it.each([
      ['another application command', slashInteraction({data: {id: 'c', name: 'other', type: 1}})],
      [
        'a command name with the wrong type',
        slashInteraction({data: {id: 'c', name: 'shipfox', type: 3}}),
      ],
      ['a message component', slashInteraction({type: 3})],
      [
        'a slash command without a prompt',
        slashInteraction({data: {id: 'c', name: 'shipfox', type: 1}}),
      ],
      ['a command outside a guild', slashInteraction({guild_id: undefined})],
    ])('answers %s as unsupported without publishing', async (_name, interaction) => {
      const {processor, publishIntegrationEventReceived} = await arrange();

      const {result, response} = await processor.processInteraction(
        signedInteractionRequest({signer, interaction}),
      );

      expect(result).toMatchObject({outcome: 'discarded', reason: 'unsupported_event'});
      expect(response).toEqual(ephemeral(DISCORD_ACK_UNSUPPORTED));
      expect(publishIntegrationEventReceived).not.toHaveBeenCalled();
    });
  });

  it('exposes only the standard result through process', async () => {
    const {processor} = await arrange();

    await expect(
      processor.process(signedInteractionRequest({signer, interaction: pingInteraction()})),
    ).resolves.toEqual({outcome: 'processed'});
  });

  it('rejects requests for other routes', async () => {
    const {processor} = await arrange();
    const {createStoredWebhookRequest} = await import('@shipfox/api-integration-spi');

    await expect(
      processor.process(
        createStoredWebhookRequest({
          requestId: randomUUID(),
          routeId: 'notion',
          receivedAt: new Date().toISOString(),
          rawQueryString: '',
          headers: {},
          body: Buffer.from('{}'),
        }),
      ),
    ).rejects.toThrow('cannot process notion');
  });
});
