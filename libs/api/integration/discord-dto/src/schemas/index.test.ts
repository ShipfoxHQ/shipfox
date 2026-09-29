import {
  createE2eDiscordConnectionBodySchema,
  DISCORD_PROVIDER,
  discordInteractionEnvelopeSchema,
  discordMessageCommandPayloadSchema,
  discordMessageCreatePayloadSchema,
  discordMessageReactionAddPayloadSchema,
  discordSlashCommandPayloadSchema,
  injectDiscordDispatchBodySchema,
} from './index.js';

const message = {
  id: 'message-1',
  channel_id: 'channel-1',
  author: {id: 'user-1', bot: false},
  mentions_bot: true,
  thread_id: 'thread-1',
  root_channel_id: 'channel-1',
  url: 'https://discord.com/channels/guild-1/channel-1/message-1',
  content: 'Hello Shipfox',
};

describe('Discord DTO schemas', () => {
  it('uses the Discord provider id', () => {
    expect(DISCORD_PROVIDER).toBe('discord');
  });

  it('retains Discord message fields and requires normalized fields', () => {
    const result = discordMessageCreatePayloadSchema.parse(message);

    expect(result.content).toBe('Hello Shipfox');
    expect(result.author.bot).toBe(false);
    expect(
      discordMessageCreatePayloadSchema.safeParse({...message, mentions_bot: undefined}).success,
    ).toBe(false);
  });

  it('accepts normalized reaction authors', () => {
    const result = discordMessageReactionAddPayloadSchema.parse({
      user_id: 'user-1',
      channel_id: 'channel-1',
      message_id: 'message-1',
      guild_id: 'guild-1',
      member: {user: {id: 'user-1', bot: false}},
      emoji: {name: '✅'},
      message_author_id: 'user-2',
      url: 'https://discord.com/channels/guild-1/channel-1/message-1',
    });

    expect(result.member.user.bot).toBe(false);
  });

  it('strips the interaction token from command event payloads', () => {
    const interaction = {
      id: 'interaction-1',
      application_id: 'application-1',
      type: 2,
      token: 'short-lived-token',
      channel_id: 'channel-1',
      guild_id: 'guild-1',
      author: {id: 'user-1', bot: false},
      prompt: 'Investigate this failure',
    };

    const result = discordSlashCommandPayloadSchema.parse(interaction);

    expect(result.prompt).toBe('Investigate this failure');
    expect(result).not.toHaveProperty('token');
  });

  it('rejects non-command interactions as command payloads', () => {
    const ping = {
      id: 'interaction-1',
      application_id: 'application-1',
      type: 1,
      author: {id: 'user-1', bot: false},
      prompt: 'Investigate this failure',
      target_message: message,
    };

    expect(discordSlashCommandPayloadSchema.safeParse(ping).success).toBe(false);
    expect(discordMessageCommandPayloadSchema.safeParse(ping).success).toBe(false);
  });

  it('keeps the interaction envelope token available before publication', () => {
    const result = discordInteractionEnvelopeSchema.parse({
      id: 'interaction-1',
      application_id: 'application-1',
      type: 2,
      token: 'short-lived-token',
    });

    expect(result.token).toBe('short-lived-token');
  });

  it('validates message command targets with the message contract', () => {
    const result = discordMessageCommandPayloadSchema.parse({
      id: 'interaction-1',
      application_id: 'application-1',
      type: 2,
      token: 'short-lived-token',
      author: {id: 'user-1', bot: false},
      target_message: message,
    });

    expect(result.target_message.mentions_bot).toBe(true);
  });

  it('accepts the E2E seed and dispatch request shapes', () => {
    expect(
      createE2eDiscordConnectionBodySchema.parse({
        workspace_id: '5c3583d6-ffb9-4486-a80d-4cf55b567462',
        guild_id: 'guild-1',
        guild_name: 'Shipfox',
      }).permissions,
    ).toBe('0');

    const dispatch = injectDiscordDispatchBodySchema.parse({
      connection_id: '5c3583d6-ffb9-4486-a80d-4cf55b567462',
      sequence: 1,
      dispatch: {type: 'MESSAGE_CREATE', data: message},
    });

    expect(dispatch.session_id).toBe('e2e-session');
    expect(dispatch.sequence).toBe(1);
    expect(dispatch.dispatch.type).toBe('MESSAGE_CREATE');
  });
});
