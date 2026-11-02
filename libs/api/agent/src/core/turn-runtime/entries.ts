import type {AssistantMessage, Tool} from '@earendil-works/pi-ai';
import type {ConversationTurnNoticeDto} from '@shipfox/api-agent-dto';
import {messageEntry} from '../conversation-entries.js';
import {TURN_NOTICE_CUSTOM_TYPE} from '../entities/conversation.js';

/** The pinned leading entry: the base prompt, and the tools in `toolsAdded`. */
export function systemMessageEntry(params: {prompt: string; tools: Tool[]}): string {
  const now = Date.now();
  return messageEntry(
    {role: 'system', content: params.prompt, toolsAdded: params.tools, timestamp: now},
    now,
  );
}

/** A `custom` entry never reaches the model. It tells the timeline why no turn ran. */
export function turnNoticeEntry(data: ConversationTurnNoticeDto): string {
  const now = new Date();
  return JSON.stringify({
    type: 'custom',
    customType: TURN_NOTICE_CUSTOM_TYPE,
    data,
    timestamp: now.toISOString(),
  });
}

/** pi's own message, stored as the model produced it, so thinking and signatures survive. */
export function assistantMessageEntry(message: AssistantMessage): string {
  return messageEntry(message, message.timestamp);
}

export function toolResultMessageEntry(params: {
  toolCallId: string;
  toolName: string;
  text: string;
  isError: boolean;
}): string {
  const now = Date.now();
  return messageEntry(
    {
      role: 'toolResult',
      toolCallId: params.toolCallId,
      toolName: params.toolName,
      content: [{type: 'text', text: params.text}],
      isError: params.isError,
      timestamp: now,
    },
    now,
  );
}
