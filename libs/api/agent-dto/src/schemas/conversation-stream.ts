import {z} from 'zod';
import {
  agentTurnStatusSchema,
  CONVERSATION_SEQ_MAX,
  conversationItemDtoSchema,
} from './conversation.js';

export const conversationStreamQuerySchema = z.object({
  /** The last `seq` the client holds. The stream sends the items after it. */
  after_seq: z.coerce.number().int().min(0).max(CONVERSATION_SEQ_MAX).default(0),
});

export type ConversationStreamQueryDto = z.infer<typeof conversationStreamQuerySchema>;

export const conversationStreamResetReasonSchema = z.enum(['reconnect', 'retry']);

/** Each event is one SSE message: `event: <name>` and a JSON `data:` line. */
export const conversationStreamEventSchema = z.discriminatedUnion('event', [
  /** An input waiting for a claim. It has no `seq`. The `item` event follows the claim. */
  z.object({event: z.literal('queued'), data: conversationItemDtoSchema}),
  /** A stored entry. An item of the turn ends the partial text, because the stored reply holds it. */
  z.object({event: z.literal('item'), data: conversationItemDtoSchema}),
  /** Text of the running model call, in order. */
  z.object({
    event: z.literal('delta'),
    data: z.object({
      turn_id: z.string().uuid(),
      model_call_index: z.number().int().min(0),
      text: z.string(),
    }),
  }),
  /** Clear partial text. Deltas that follow restart the running call from its first chunk. */
  z.object({
    event: z.literal('reset'),
    data: z.object({reason: conversationStreamResetReasonSchema}),
  }),
  /** The status of the turn the stream follows. A final status ends the stream. */
  z.object({
    event: z.literal('turn'),
    data: z.object({
      turn_id: z.string().uuid(),
      status: agentTurnStatusSchema,
      failure_code: z.string().nullable(),
    }),
  }),
]);

export type ConversationStreamEventDto = z.infer<typeof conversationStreamEventSchema>;
