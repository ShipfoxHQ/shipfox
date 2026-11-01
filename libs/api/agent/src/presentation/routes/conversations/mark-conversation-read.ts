import {markConversationReadBodySchema} from '@shipfox/api-agent-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {markConversationRead} from '#db/conversations.js';
import {requireWebConversation} from './access.js';

export const markConversationReadRoute = defineRoute({
  method: 'POST',
  path: '/:conversationId/read',
  description: 'Mark a conversation read up to a seq.',
  schema: {
    params: z.object({conversationId: z.string().uuid()}),
    body: markConversationReadBodySchema,
    response: {
      204: z.void(),
    },
  },
  handler: async (request, reply) => {
    const conversation = await requireWebConversation(request, request.params.conversationId);

    await markConversationRead({
      conversationId: conversation.id,
      lastReadSeq: request.body.last_read_seq,
    });

    reply.code(204);
  },
});
