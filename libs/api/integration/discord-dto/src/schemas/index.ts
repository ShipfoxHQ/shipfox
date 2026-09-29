import {integrationConnectionDtoSchema} from '@shipfox/api-integration-core-dto';
import {z} from 'zod';

export const DISCORD_PROVIDER = 'discord';
export type DiscordProvider = typeof DISCORD_PROVIDER;

export const DISCORD_MESSAGE_CREATE_EVENT = 'message_create' as const;
export const DISCORD_MESSAGE_REACTION_ADD_EVENT = 'message_reaction_add' as const;
export const DISCORD_SLASH_COMMAND_EVENT = 'slash_command' as const;
export const DISCORD_MESSAGE_COMMAND_EVENT = 'message_command' as const;

export const discordGatewayEventNames = [
  DISCORD_MESSAGE_CREATE_EVENT,
  DISCORD_MESSAGE_REACTION_ADD_EVENT,
] as const;
export const discordEventNames = [
  ...discordGatewayEventNames,
  DISCORD_SLASH_COMMAND_EVENT,
  DISCORD_MESSAGE_COMMAND_EVENT,
] as const;

export type DiscordGatewayEventName = (typeof discordGatewayEventNames)[number];
export type DiscordEventName = (typeof discordEventNames)[number];

export const discordEventNameSchema = z.enum(discordEventNames);
export const discordGatewayEventNameSchema = z.enum(discordGatewayEventNames);

const discordAuthorSchema = z
  .object({
    bot: z.boolean().describe('Whether the author is a bot; normalized to an explicit boolean.'),
  })
  .passthrough();

const discordReactionMemberSchema = z
  .object({
    user: discordAuthorSchema,
  })
  .passthrough();

export const discordMessageCreatePayloadSchema = z
  .object({
    id: z.string().min(1),
    channel_id: z.string().min(1),
    author: discordAuthorSchema,
    mentions_bot: z.boolean(),
    thread_id: z.string().min(1).optional(),
    root_channel_id: z.string().min(1).optional(),
    url: z.string().url(),
  })
  .passthrough();
export type DiscordMessageCreatePayloadDto = z.infer<typeof discordMessageCreatePayloadSchema>;

export const discordMessageReactionAddPayloadSchema = z
  .object({
    user_id: z.string().min(1),
    channel_id: z.string().min(1),
    message_id: z.string().min(1),
    guild_id: z.string().min(1),
    member: discordReactionMemberSchema,
    emoji: z.record(z.string(), z.unknown()),
    message_author_id: z.string().min(1),
    root_channel_id: z.string().min(1).optional(),
    url: z.string().url(),
  })
  .passthrough();
export type DiscordMessageReactionAddPayloadDto = z.infer<
  typeof discordMessageReactionAddPayloadSchema
>;

const discordInteractionBaseFields = {
  id: z.string().min(1),
  application_id: z.string().min(1),
  type: z.number().int(),
  version: z.number().int().optional(),
  guild_id: z.string().min(1).optional(),
  channel_id: z.string().min(1).optional(),
  member: z.record(z.string(), z.unknown()).optional(),
  user: z.record(z.string(), z.unknown()).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  app_permissions: z.string().optional(),
  locale: z.string().min(1).optional(),
  guild_locale: z.string().min(1).optional(),
};

export const discordInteractionEnvelopeSchema = z
  .object({
    ...discordInteractionBaseFields,
    token: z.string().min(1),
  })
  .passthrough();
export const discordInteractionSchema = discordInteractionEnvelopeSchema;
export type DiscordInteractionEnvelopeDto = z.infer<typeof discordInteractionEnvelopeSchema>;
export type DiscordInteractionDto = DiscordInteractionEnvelopeDto;

const discordCommandAuthorSchema = discordAuthorSchema;

// Command events only come from APPLICATION_COMMAND interactions (type 2).
// The base schemas are the documented shape; the payload schemas strip the
// interaction token before publication, which JSON Schema cannot represent.
export const discordSlashCommandPayloadBaseSchema = z
  .object({
    ...discordInteractionBaseFields,
    type: z.literal(2),
    author: discordCommandAuthorSchema,
    prompt: z.string(),
    root_channel_id: z.string().min(1).optional(),
  })
  .passthrough();
export const discordSlashCommandPayloadSchema = discordSlashCommandPayloadBaseSchema.transform(
  ({token: _token, ...payload}) => payload,
);
export type DiscordSlashCommandPayloadDto = z.infer<typeof discordSlashCommandPayloadSchema>;

export const discordMessageCommandPayloadBaseSchema = z
  .object({
    ...discordInteractionBaseFields,
    type: z.literal(2),
    author: discordCommandAuthorSchema,
    target_message: discordMessageCreatePayloadSchema,
    root_channel_id: z.string().min(1).optional(),
  })
  .passthrough();
export const discordMessageCommandPayloadSchema = discordMessageCommandPayloadBaseSchema.transform(
  ({token: _token, ...payload}) => payload,
);
export type DiscordMessageCommandPayloadDto = z.infer<typeof discordMessageCommandPayloadSchema>;

export const discordInteractionPayloadSchema = z.discriminatedUnion('type', [
  discordInteractionEnvelopeSchema.extend({type: z.literal(1)}),
  discordInteractionEnvelopeSchema.extend({type: z.literal(2)}),
]);
export type DiscordInteractionPayloadDto = z.infer<typeof discordInteractionPayloadSchema>;

export const createE2eDiscordConnectionBodySchema = z
  .object({
    workspace_id: z.string().uuid(),
    guild_id: z.string().min(1),
    guild_name: z.string().min(1),
    permissions: z.string().min(1).default('0'),
    bot_role_id: z.string().min(1).optional(),
  })
  .passthrough();
export type CreateE2eDiscordConnectionBodyDto = z.infer<
  typeof createE2eDiscordConnectionBodySchema
>;

export const createE2eDiscordConnectionResponseSchema = integrationConnectionDtoSchema;
export type CreateE2eDiscordConnectionResponseDto = z.infer<
  typeof createE2eDiscordConnectionResponseSchema
>;

const discordGatewayDispatchSchema = z
  .object({
    op: z.number().int().optional(),
    t: z.string().min(1).optional(),
    s: z.number().int().optional(),
    type: z.string().min(1).optional(),
    event: z.string().min(1).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    d: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const injectDiscordDispatchBodySchema = z
  .object({
    connection_id: z.string().uuid(),
    session_id: z.string().min(1).default('e2e-session'),
    sequence: z.number().int().nonnegative().optional(),
    dispatch: discordGatewayDispatchSchema,
  })
  .passthrough();
export const injectE2eDiscordDispatchBodySchema = injectDiscordDispatchBodySchema;
export type InjectDiscordDispatchBodyDto = z.infer<typeof injectDiscordDispatchBodySchema>;
export type InjectE2eDiscordDispatchBodyDto = InjectDiscordDispatchBodyDto;

export const createDiscordInstallBodySchema = z.object({
  workspace_id: z.string().uuid(),
});
export type CreateDiscordInstallBodyDto = z.infer<typeof createDiscordInstallBodySchema>;

export const createDiscordInstallResponseSchema = z.object({
  install_url: z.string().url(),
});
export type CreateDiscordInstallResponseDto = z.infer<typeof createDiscordInstallResponseSchema>;

export const discordCallbackQuerySchema = z.union([
  z.object({
    code: z.string().min(1),
    state: z.string().min(1),
  }),
  z.object({
    error: z.string().min(1),
    error_description: z.string().min(1).optional(),
    state: z.string().min(1),
  }),
]);
export type DiscordCallbackQueryDto = z.infer<typeof discordCallbackQuerySchema>;

const discordConnectedCallbackResponseSchema = z.object({
  outcome: z.literal('connected'),
  connection: integrationConnectionDtoSchema,
});
const discordReconnectedCallbackResponseSchema = z.object({
  outcome: z.literal('reconnected'),
  connection: integrationConnectionDtoSchema,
});
const discordAccessDeniedCallbackResponseSchema = z.object({
  outcome: z.literal('access_denied'),
});

// Other callback failures are non-2xx API errors, not 200 outcomes.
export const discordCallbackResponseSchema = z.discriminatedUnion('outcome', [
  discordConnectedCallbackResponseSchema,
  discordReconnectedCallbackResponseSchema,
  discordAccessDeniedCallbackResponseSchema,
]);
export type DiscordCallbackResponseDto = z.infer<typeof discordCallbackResponseSchema>;
