import {
  eventPayloadJsonSchema,
  type IntegrationEventCatalog,
} from '@shipfox/api-integration-core-dto';
import {
  SLACK_SLASH_COMMAND_EVENT,
  slackEventNames,
  slackEventPayloadSchema,
  slackSlashCommandPayloadSchema,
} from './schemas/index.js';

const eventDetails = {
  app_mention: {
    summary: 'A Slack message mentions the installed app.',
    payloadDocUrl: 'https://docs.slack.dev/reference/events/app_mention/',
  },
  message: {
    summary: 'A message event arrives from a subscribed Slack conversation.',
    payloadDocUrl: 'https://docs.slack.dev/reference/events/message/',
  },
  reaction_added: {
    summary: 'A member adds an emoji reaction to a Slack item.',
    payloadDocUrl: 'https://docs.slack.dev/reference/events/reaction_added/',
  },
  slash_command: {
    summary: 'A user invokes a slash command for the installed app.',
    payloadDocUrl: 'https://docs.slack.dev/interactivity/implementing-slash-commands/',
  },
} as const satisfies Record<
  (typeof slackEventNames)[number],
  {
    summary: string;
    payloadDocUrl: string;
  }
>;

export const slackEventCatalog = {
  provider: 'Slack',
  families: [
    {
      key: 'event',
      title: 'Events API',
      summary:
        'Activity from conversations that the installed app watches. Your workflow also receives the workspace ID, app ID, event ID, and event time.',
      payloadKind: 'shipfox-normalized',
      payloadSchema: eventPayloadJsonSchema(slackEventPayloadSchema),
      payloadDocUrl: 'https://docs.slack.dev/reference/events/',
      shipfoxFields: ['team_id', 'api_app_id', 'event_id', 'event_time'],
    },
    {
      key: 'slash_command',
      title: 'Slash commands',
      summary:
        'Slash commands sent to the installed app. The event does not include the Slack verification token.',
      payloadKind: 'shipfox-normalized',
      payloadSchema: eventPayloadJsonSchema(slackSlashCommandPayloadSchema),
      payloadDocUrl: eventDetails.slash_command.payloadDocUrl,
    },
  ],
  events: slackEventNames.map((name) => ({
    name,
    family: name === SLACK_SLASH_COMMAND_EVENT ? 'slash_command' : 'event',
    ...eventDetails[name],
  })),
} as const satisfies IntegrationEventCatalog;
