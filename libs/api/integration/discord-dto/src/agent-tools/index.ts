import {z} from 'zod';

export const discordAgentToolIds = [
  'read_channel',
  'read_thread',
  'search_messages',
  'list_channels',
  'read_user_profile',
  'send_message',
  'create_thread',
  'update_message',
  'add_reaction',
] as const;

export const discordAgentToolIdSchema = z.enum(discordAgentToolIds);
export type DiscordAgentToolId = z.infer<typeof discordAgentToolIdSchema>;

export const discordAgentToolRequiredScopes = ['read', 'write'] as const;
export const discordAgentToolRequiredScopeSchema = z.enum(discordAgentToolRequiredScopes);
export type DiscordAgentToolRequiredScope = z.infer<typeof discordAgentToolRequiredScopeSchema>;
