import type {UserMessage} from '@earendil-works/pi-ai';
import type {PageContextDto} from '@shipfox/api-agent-dto';

/** The pi session version entries are written in. Routes don't load pi, so it is held here. */
export const CONVERSATION_SESSION_VERSION = 3;

// `page_context` is a closed schema of IDs, integers, and tokens, so no value needs escaping.
// `status` only picks suggested prompts in the client, so it stays out of the prompt.
export function conversationPageNote(pageContext: PageContextDto): string {
  const attributes = Object.entries(pageContext)
    .filter(([name]) => name !== 'status')
    .map(([name, value]) => `${name}="${value}"`);
  return `<page_context ${attributes.join(' ')}/>`;
}

/**
 * The pi entry for a user message, as stored. The user's text is always the
 * first block and the page note the second, because projections rely on that
 * position to keep the note away from clients.
 */
export function userMessageEntry(params: {
  body: string;
  pageContext?: PageContextDto | undefined;
}): string {
  const now = new Date();
  const message: UserMessage = {
    role: 'user',
    content: [
      {type: 'text', text: params.body},
      ...(params.pageContext
        ? [{type: 'text' as const, text: conversationPageNote(params.pageContext)}]
        : []),
    ],
    timestamp: now.getTime(),
  };
  return JSON.stringify({type: 'message', timestamp: now.toISOString(), message});
}

export function parseConversationEntry(entry: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(entry);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
