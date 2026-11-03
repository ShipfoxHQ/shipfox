import {sessionViewRowSchema} from '@shipfox/api-logs-dto';
import {requiredActionSchema} from '@shipfox/policy-notice';
import {z} from 'zod';

export const CONVERSATION_MESSAGE_MAX_BYTES = 32 * 1024;

// `seq` columns are int4, so a larger value would reach Postgres and fail as a 500.
export const CONVERSATION_SEQ_MAX = 2_147_483_647;

export const agentTurnStatusSchema = z.enum(['running', 'succeeded', 'failed', 'stopped']);

export type AgentTurnStatus = z.infer<typeof agentTurnStatusSchema>;

// `workflows-dto` depends on this package, so its status enums can't be imported here. A short
// token keeps page context free of prose, because it is stored in plain `meta`.
const pageContextTokenSchema = z.string().regex(/^[a-z_]{1,32}$/);

export const pageContextSchema = z.discriminatedUnion('page', [
  z.strictObject({page: z.literal('runs')}),
  z.strictObject({
    page: z.literal('run'),
    run_id: z.string().uuid(),
    attempt: z.number().int().min(1).optional(),
    status: pageContextTokenSchema.optional(),
  }),
  z.strictObject({
    page: z.literal('job'),
    run_id: z.string().uuid(),
    attempt: z.number().int().min(1).optional(),
    job_id: z.string().uuid(),
    step_id: z.string().uuid().optional(),
    status: pageContextTokenSchema.optional(),
  }),
  z.strictObject({page: z.literal('workflows')}),
  z.strictObject({page: z.literal('workflow'), definition_id: z.string().uuid()}),
  z.strictObject({page: z.literal('project_settings'), section: pageContextTokenSchema}),
]);

export type PageContextDto = z.infer<typeof pageContextSchema>;

const conversationMessageBodySchema = z
  .string()
  .refine((body) => body.trim().length > 0, {message: 'Message must not be empty.'})
  .refine((body) => new TextEncoder().encode(body).length <= CONVERSATION_MESSAGE_MAX_BYTES, {
    message: `Message must be at most ${CONVERSATION_MESSAGE_MAX_BYTES} bytes.`,
  });

export const postConversationMessageBodySchema = z.object({
  client_message_id: z.string().uuid(),
  body: conversationMessageBodySchema,
  page_context: pageContextSchema.optional(),
});

export type PostConversationMessageBodyDto = z.infer<typeof postConversationMessageBodySchema>;

export const createConversationBodySchema = postConversationMessageBodySchema.extend({
  /** The agent to talk to. Without it, the conversation is with the built-in agent. */
  agent_key: z.string().min(1).optional(),
});

export type CreateConversationBodyDto = z.infer<typeof createConversationBodySchema>;

export const conversationRunResultDtoSchema = z.object({
  workflow_run_id: z.string().uuid(),
  run_attempt_id: z.string().uuid(),
  status: z.string(),
  job_keys: z.array(z.string()),
  outputs: z.record(z.string(), z.unknown()).nullable(),
});

export type ConversationRunResultDto = z.infer<typeof conversationRunResultDtoSchema>;

export const conversationTurnNoticeDtoSchema = z.object({
  code: z.string(),
  message: z.string().nullable(),
  required_action: requiredActionSchema.nullable(),
});

export type ConversationTurnNoticeDto = z.infer<typeof conversationTurnNoticeDtoSchema>;

export const conversationItemContentDtoSchema = z.discriminatedUnion('type', [
  z.object({type: z.literal('rows'), rows: z.array(sessionViewRowSchema)}),
  z.object({type: z.literal('run_result'), run_result: conversationRunResultDtoSchema}),
  z.object({type: z.literal('turn_notice'), turn_notice: conversationTurnNoticeDtoSchema}),
]);

export type ConversationItemContentDto = z.infer<typeof conversationItemContentDtoSchema>;

export const conversationItemDtoSchema = z.object({
  id: z.string().uuid(),
  /** Null while the item is queued. A claim assigns it. */
  seq: z.number().int().min(1).nullable(),
  /** pi's entry type. A new type needs no contract change. */
  entry_type: z.string(),
  turn_id: z.string().uuid().nullable(),
  author_user_id: z.string().uuid().nullable(),
  client_message_id: z.string().uuid().nullable(),
  /** Null when the stored entry can't be opened. The rest of the timeline stays readable. */
  content: conversationItemContentDtoSchema.nullable(),
  created_at: z.string().datetime(),
});

export type ConversationItemDto = z.infer<typeof conversationItemDtoSchema>;

export const conversationSummaryDtoSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  agent_key: z.string(),
  /** Null when the stored title can't be opened. */
  title: z.string().nullable(),
  unread: z.boolean(),
  last_seq: z.number().int().min(0),
  last_agent_seq: z.number().int().min(0),
  last_read_seq: z.number().int().min(0),
  last_activity_at: z.string().datetime(),
  created_at: z.string().datetime(),
});

export type ConversationSummaryDto = z.infer<typeof conversationSummaryDtoSchema>;

export const conversationActiveTurnDtoSchema = z.object({
  id: z.string().uuid(),
  status: agentTurnStatusSchema,
  started_at: z.string().datetime(),
  stop_requested_at: z.string().datetime().nullable(),
});

export type ConversationActiveTurnDto = z.infer<typeof conversationActiveTurnDtoSchema>;

export const conversationLatestTurnDtoSchema = conversationActiveTurnDtoSchema.extend({
  /** Why the turn failed. Set only when `status` is `failed`. */
  failure_code: z.string().nullable(),
  /** The model the turn ran on, so a client can name a model that became unavailable. */
  model: z.string().nullable(),
  provider: z.string().nullable(),
  finished_at: z.string().datetime().nullable(),
});

export type ConversationLatestTurnDto = z.infer<typeof conversationLatestTurnDtoSchema>;

export const conversationDetailDtoSchema = conversationSummaryDtoSchema.extend({
  active_turn: conversationActiveTurnDtoSchema.nullable(),
  /** The most recent turn, finished or not, so a reader can show why a reply failed. */
  latest_turn: conversationLatestTurnDtoSchema.nullable(),
});

export type ConversationDetailDto = z.infer<typeof conversationDetailDtoSchema>;

export const createConversationResponseSchema = z.object({
  conversation: conversationSummaryDtoSchema,
  item: conversationItemDtoSchema,
});

export type CreateConversationResponseDto = z.infer<typeof createConversationResponseSchema>;

export const listConversationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export type ListConversationsQueryDto = z.infer<typeof listConversationsQuerySchema>;

export const listConversationsResponseSchema = z.object({
  conversations: z.array(conversationSummaryDtoSchema),
  next_cursor: z.string().nullable(),
  /** Conversations with an unread reply, across every page. */
  unread_count: z.number().int().min(0),
});

export type ListConversationsResponseDto = z.infer<typeof listConversationsResponseSchema>;

export const listConversationItemsQuerySchema = z
  .object({
    after_seq: z.coerce.number().int().min(0).max(CONVERSATION_SEQ_MAX).optional(),
    before_seq: z.coerce.number().int().min(1).max(CONVERSATION_SEQ_MAX).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((query) => query.after_seq === undefined || query.before_seq === undefined, {
    message: 'Use after_seq or before_seq, not both.',
  });

export type ListConversationItemsQueryDto = z.infer<typeof listConversationItemsQuerySchema>;

export const listConversationItemsResponseSchema = z.object({
  /** Claimed items in ascending `seq` order. With no cursor, the latest page. */
  items: z.array(conversationItemDtoSchema),
  /**
   * Inputs waiting for a claim, oldest first. They have no `seq`, so no cursor reaches them, and
   * `limit` doesn't apply. Only a fixed cap does, and `queued_has_more` reports it.
   */
  queued: z.array(conversationItemDtoSchema),
  queued_has_more: z.boolean(),
  has_more: z.boolean(),
});

export type ListConversationItemsResponseDto = z.infer<typeof listConversationItemsResponseSchema>;

export const markConversationReadBodySchema = z.object({
  last_read_seq: z.number().int().min(0).max(CONVERSATION_SEQ_MAX),
});

export type MarkConversationReadBodyDto = z.infer<typeof markConversationReadBodySchema>;
