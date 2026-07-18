import {integrationConnectionDtoSchema} from '@shipfox/api-integration-core-dto';
import {z} from 'zod';

export const SLACK_PROVIDER = 'slack';
export type SlackProvider = typeof SLACK_PROVIDER;

export const slackApiEventTypes = ['app_mention', 'message', 'reaction_added'] as const;
export const SLACK_SLASH_COMMAND_EVENT = 'slash_command' as const;
export const slackEventNames = [...slackApiEventTypes, SLACK_SLASH_COMMAND_EVENT] as const;

export type SlackApiEventType = (typeof slackApiEventTypes)[number];
export type SlackEventName = (typeof slackEventNames)[number];

export const slackInnerEventBaseSchema = z
  .object({
    type: z.string().min(1),
  })
  .passthrough();

export const slackInnerEventSchema = z
  .object({
    type: z.enum(slackApiEventTypes),
  })
  .passthrough();

export const slackEventBaseEnvelopeSchema = z.object({
  type: z.literal('event_callback'),
  team_id: z.string().min(1),
  api_app_id: z.string().min(1),
  event: slackInnerEventBaseSchema,
  event_id: z.string().min(1),
  event_time: z.number().int(),
  authorizations: z.array(z.unknown()).optional(),
});
export type SlackEventBaseEnvelopeDto = z.infer<typeof slackEventBaseEnvelopeSchema>;

export const slackEventEnvelopeSchema = slackEventBaseEnvelopeSchema.extend({
  event: slackInnerEventSchema,
});
export type SlackEventEnvelopeDto = z.infer<typeof slackEventEnvelopeSchema>;

export const slackUrlVerificationSchema = z.object({
  type: z.literal('url_verification'),
  token: z.string().min(1),
  challenge: z.string().min(1),
});
export type SlackUrlVerificationDto = z.infer<typeof slackUrlVerificationSchema>;

export const slackEventsRequestSchema = z.discriminatedUnion('type', [
  slackUrlVerificationSchema,
  slackEventBaseEnvelopeSchema,
]);
export type SlackEventsRequestDto = z.infer<typeof slackEventsRequestSchema>;

export const slackSlashCommandSchema = z.object({
  token: z.string().min(1),
  command: z.string().min(1),
  team_id: z.string().min(1),
  channel_id: z.string().min(1),
  user_id: z.string().min(1),
  response_url: z.string().url(),
  trigger_id: z.string().min(1),
  text: z.string().default(''),
  team_domain: z.string().min(1).optional(),
  channel_name: z.string().min(1).optional(),
  user_name: z.string().min(1).optional(),
  api_app_id: z.string().min(1).optional(),
  is_enterprise_install: z.string().min(1).optional(),
  enterprise_id: z.string().min(1).optional(),
  enterprise_name: z.string().min(1).optional(),
});
export type SlackSlashCommandDto = z.infer<typeof slackSlashCommandSchema>;

export const slackSlashCommandPayloadSchema = slackSlashCommandSchema.omit({token: true});
export type SlackSlashCommandPayloadDto = z.infer<typeof slackSlashCommandPayloadSchema>;

export const slackEventPayloadSchema = z
  .object({
    type: z.enum(slackApiEventTypes),
    team_id: z.string().min(1),
    api_app_id: z.string().min(1),
    event_id: z.string().min(1),
    event_time: z.number().int(),
    channel: z.string().min(1).optional(),
    channel_type: z.string().min(1).optional(),
    user: z.string().min(1).optional(),
    ts: z.string().min(1).optional(),
    thread_ts: z.string().min(1).optional(),
    text: z.string().optional(),
    bot_id: z.string().min(1).optional(),
    reaction: z.string().min(1).optional(),
  })
  .passthrough();
export type SlackEventPayloadDto = z.infer<typeof slackEventPayloadSchema>;

export const createSlackInstallBodySchema = z.object({
  workspace_id: z.string().uuid(),
});
export type CreateSlackInstallBodyDto = z.infer<typeof createSlackInstallBodySchema>;

export const createSlackInstallResponseSchema = z.object({
  install_url: z.string().url(),
});
export type CreateSlackInstallResponseDto = z.infer<typeof createSlackInstallResponseSchema>;

export const slackCallbackQuerySchema = z.union([
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
export type SlackCallbackQueryDto = z.infer<typeof slackCallbackQuerySchema>;

export const slackCallbackResponseSchema = integrationConnectionDtoSchema;
export type SlackCallbackResponseDto = z.infer<typeof slackCallbackResponseSchema>;

export const createE2eSlackConnectionBodySchema = z.object({
  workspace_id: z.string().uuid(),
  team_id: z.string().min(1),
  team_name: z.string().min(1),
  app_id: z.string().min(1),
  bot_user_id: z.string().min(1),
  bot_token: z.string().min(1),
  scopes: z.array(z.string().min(1)).min(1).default(['app_mentions:read', 'chat:write']),
});
export type CreateE2eSlackConnectionBodyDto = z.infer<typeof createE2eSlackConnectionBodySchema>;

export const createE2eSlackConnectionResponseSchema = integrationConnectionDtoSchema;
export type CreateE2eSlackConnectionResponseDto = z.infer<
  typeof createE2eSlackConnectionResponseSchema
>;
