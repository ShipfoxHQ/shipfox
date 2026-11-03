import type {ConversationStreamEventDto} from '@shipfox/api-agent-dto';
import type {ConversationStreamEvent} from '#core/conversation-stream.js';
import {toConversationItemDto} from './conversation.js';

export function toConversationStreamEventDto(
  event: ConversationStreamEvent,
): ConversationStreamEventDto {
  switch (event.type) {
    case 'queued':
    case 'item':
      return {event: event.type, data: toConversationItemDto(event.item)};
    case 'delta':
      return {
        event: 'delta',
        data: {turn_id: event.turnId, model_call_index: event.modelCallIndex, text: event.text},
      };
    case 'reset':
      return {event: 'reset', data: {reason: event.reason}};
    case 'turn':
      return {
        event: 'turn',
        data: {turn_id: event.turnId, status: event.status, failure_code: event.failureCode},
      };
  }
}

/** One SSE message. The JSON has no newline, so it fits one `data:` line. */
export function toServerSentEvent(event: ConversationStreamEventDto): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}
