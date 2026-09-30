import type {DiscordApiClient} from '#api/client.js';

const THREAD_NAME_LENGTH = 80;
const WHITESPACE_RE = /\s+/g;

/**
 * Returns the id of the thread that hangs off a message, starting a public one named after the
 * message's first 80 characters when there is none. The channel must already be verified.
 */
export async function ensureMessageThread(input: {
  discord: Pick<DiscordApiClient, 'getMessage' | 'startThreadFromMessage'>;
  channelId: string;
  messageId: string;
}): Promise<string> {
  const {discord, channelId, messageId} = input;
  const message = await discord.getMessage({channelId, messageId});
  if (message.thread) return message.thread.id;
  const thread = await discord.startThreadFromMessage({
    channelId,
    messageId,
    name: threadName(message.content),
  });
  return thread.id;
}

function threadName(content: string): string {
  const name = Array.from(content.replace(WHITESPACE_RE, ' ').trim())
    .slice(0, THREAD_NAME_LENGTH)
    .join('');
  return name === '' ? 'Thread' : name;
}
