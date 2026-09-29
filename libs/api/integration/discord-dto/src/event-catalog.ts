import {
  eventPayloadJsonSchema,
  type IntegrationEventCatalog,
} from '@shipfox/api-integration-core-dto';
import {
  DISCORD_MESSAGE_COMMAND_EVENT,
  DISCORD_MESSAGE_CREATE_EVENT,
  DISCORD_MESSAGE_REACTION_ADD_EVENT,
  DISCORD_SLASH_COMMAND_EVENT,
  discordEventNames,
  discordMessageCommandPayloadSchema,
  discordMessageCreatePayloadSchema,
  discordMessageReactionAddPayloadSchema,
  discordSlashCommandPayloadSchema,
} from './schemas/index.js';

const discordEventsDocsUrl = 'https://docs.discord.com/developers/events/gateway-events';
const discordInteractionsDocsUrl =
  'https://docs.discord.com/developers/interactions/receiving-and-responding';

const eventDetails = {
  [DISCORD_MESSAGE_CREATE_EVENT]: {
    family: 'gateway',
    summary: 'A message is created in a Discord channel or thread.',
    payloadDocUrl: `${discordEventsDocsUrl}#message-create-message-create-event`,
  },
  [DISCORD_MESSAGE_REACTION_ADD_EVENT]: {
    family: 'gateway',
    summary: 'A member adds a reaction to a Discord message.',
    payloadDocUrl: `${discordEventsDocsUrl}#message-reaction-add-message-reaction-add-event`,
  },
  [DISCORD_SLASH_COMMAND_EVENT]: {
    family: 'slash_command',
    summary: 'A member invokes the /shipfox slash command.',
    payloadDocUrl: discordInteractionsDocsUrl,
  },
  [DISCORD_MESSAGE_COMMAND_EVENT]: {
    family: 'message_command',
    summary: 'A member invokes the Send to Shipfox message command.',
    payloadDocUrl: discordInteractionsDocsUrl,
  },
} as const satisfies Record<
  (typeof discordEventNames)[number],
  {family: string; summary: string; payloadDocUrl: string}
>;

export const discordEventCatalog = {
  provider: 'Discord',
  upstreamEventsDocUrl: discordEventsDocsUrl,
  families: [
    {
      key: 'gateway',
      title: 'Gateway events',
      summary: 'Messages and reactions delivered by the Discord Gateway.',
      payloadKind: 'shipfox-normalized',
      payloadSchema: eventPayloadJsonSchema(
        discordMessageCreatePayloadSchema.or(discordMessageReactionAddPayloadSchema),
      ),
      payloadDocUrl: discordEventsDocsUrl,
      shipfoxFields: ['mentions_bot', 'author.bot', 'thread_id', 'root_channel_id', 'url'],
    },
    {
      key: 'slash_command',
      title: 'Slash commands',
      summary: 'The Shipfox slash command delivered as a Discord interaction.',
      payloadKind: 'shipfox-normalized',
      payloadSchema: eventPayloadJsonSchema(discordSlashCommandPayloadSchema),
      payloadDocUrl: discordInteractionsDocsUrl,
      shipfoxFields: ['prompt', 'author', 'root_channel_id'],
    },
    {
      key: 'message_command',
      title: 'Message commands',
      summary: 'The Send to Shipfox message command delivered as a Discord interaction.',
      payloadKind: 'shipfox-normalized',
      payloadSchema: eventPayloadJsonSchema(discordMessageCommandPayloadSchema),
      payloadDocUrl: discordInteractionsDocsUrl,
      shipfoxFields: ['target_message', 'author', 'root_channel_id'],
    },
  ],
  events: discordEventNames.map((name) => ({
    name,
    family: eventDetails[name].family,
    summary: eventDetails[name].summary,
    payloadDocUrl: eventDetails[name].payloadDocUrl,
  })),
} as const satisfies IntegrationEventCatalog;
