import type {AssistantMessage, Tool} from '@earendil-works/pi-ai';

// pi stores a session as entries, and an entry is a timestamped wrapper around one message.
function messageEntry(message: object, timestamp: number): string {
  return JSON.stringify({type: 'message', timestamp: new Date(timestamp).toISOString(), message});
}

/** The pinned leading entry: the base prompt, and the tools in `toolsAdded`. */
export function systemMessageEntry(params: {prompt: string; tools: Tool[]}): string {
  const now = Date.now();
  return messageEntry(
    {role: 'system', content: params.prompt, toolsAdded: params.tools, timestamp: now},
    now,
  );
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
