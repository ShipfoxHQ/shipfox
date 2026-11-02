import {once} from 'node:events';
import type {OutgoingHttpHeaders, ServerResponse} from 'node:http';
import {conversationStreamQuerySchema} from '@shipfox/api-agent-dto';
import {reportError} from '@shipfox/node-error-monitoring';
import {defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import {z} from 'zod';
import {STREAM_MAX_DURATION_MS, streamConversation} from '#core/conversation-stream.js';
import {type ConversationStreamOutcome, conversationStreamCount} from '#metrics/index.js';
import {
  toConversationStreamEventDto,
  toServerSentEvent,
} from '#presentation/dto/conversation-stream.js';
import {requireWebConversation, translateConversationRouteError} from './access.js';

/** Under every idle timeout a proxy is likely to apply, so a quiet turn keeps its connection. */
export const STREAM_HEARTBEAT_INTERVAL_MS = 15_000;

const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  // Asks nginx-style proxies not to buffer the stream.
  'x-accel-buffering': 'no',
} as const;

async function write(response: ServerResponse, frame: string, signal: AbortSignal) {
  if (response.write(frame)) return;
  await once(response, 'drain', {signal});
}

/**
 * Streams a conversation's live turn as server-sent events. `reply.hijack()` takes the response
 * from Fastify, so headers set by earlier hooks, such as CORS, are copied onto it here.
 */
export const streamConversationRoute = defineRoute({
  method: 'GET',
  path: '/:conversationId/stream',
  description:
    'Stream the items and live text of a conversation turn as server-sent events, after a seq.',
  schema: {
    params: z.object({conversationId: z.string().uuid()}),
    querystring: conversationStreamQuerySchema,
  },
  errorHandler: translateConversationRouteError,
  handler: async (request, reply) => {
    const conversation = await requireWebConversation(request, request.params.conversationId);

    const controller = new AbortController();
    const response = reply.raw;
    const onClose = () => controller.abort();
    response.once('close', onClose);
    reply.hijack();
    const headers: OutgoingHttpHeaders = {
      ...(reply.getHeaders() as OutgoingHttpHeaders),
      ...SSE_HEADERS,
    };
    response.writeHead(200, headers);
    response.write(': connected\n\n');

    const heartbeat = setInterval(
      () => response.write(': heartbeat\n\n'),
      STREAM_HEARTBEAT_INTERVAL_MS,
    );
    const startedAt = Date.now();
    let outcome: ConversationStreamOutcome = 'completed';
    try {
      const events = streamConversation({
        conversation,
        afterSeq: request.query.after_seq,
        signal: controller.signal,
      });
      for await (const event of events) {
        await write(
          response,
          toServerSentEvent(toConversationStreamEventDto(event)),
          controller.signal,
        );
      }
      if (controller.signal.aborted) outcome = 'disconnected';
      else if (Date.now() - startedAt >= STREAM_MAX_DURATION_MS) outcome = 'deadline';
    } catch (error) {
      if (controller.signal.aborted) {
        outcome = 'disconnected';
      } else {
        outcome = 'failed';
        // Headers are sent, so the reader learns of the failure from the closed stream.
        logger().error({err: error, conversationId: conversation.id}, 'Conversation stream failed');
        reportError(error, {
          boundary: 'agent.conversation-stream',
          extra: {conversationId: conversation.id},
        });
      }
    } finally {
      clearInterval(heartbeat);
      response.off('close', onClose);
      conversationStreamCount.add(1, {outcome});
      response.end();
    }
  },
});
