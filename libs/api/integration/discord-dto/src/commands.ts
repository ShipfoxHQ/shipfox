/** Discord's application-command context value for guilds (servers). */
export const DISCORD_GUILD_COMMAND_CONTEXT = 0 as const;

export const discordSlashCommandDefinition = {
  name: 'shipfox',
  description: 'Start a request with Shipfox.',
  type: 1,
  contexts: [DISCORD_GUILD_COMMAND_CONTEXT],
  options: [
    {
      name: 'prompt',
      description: 'The request to send to Shipfox.',
      type: 3,
      required: true,
    },
  ],
} as const;

export const discordMessageCommandDefinition = {
  name: 'Send to Shipfox',
  type: 3,
  contexts: [DISCORD_GUILD_COMMAND_CONTEXT],
} as const;

export const discordCommandDefinitions = [
  discordSlashCommandDefinition,
  discordMessageCommandDefinition,
] as const;

export const DISCORD_SLASH_COMMAND = discordSlashCommandDefinition;
export const DISCORD_MESSAGE_COMMAND = discordMessageCommandDefinition;
export const DISCORD_COMMAND_DEFINITIONS = discordCommandDefinitions;
