export interface SlackConversation {
  connectionId: string;
  channel: string;
  threadTs: string;
}

export function slackConversationKey(conversation: SlackConversation): string {
  return `${conversation.connectionId}:${conversation.channel}:${conversation.threadTs}`;
}

export function parseSlackConversationKey(key: string): SlackConversation | undefined {
  const [connectionId, channel, threadTs, ...rest] = key.split(':');
  if (!connectionId || !channel || !threadTs || rest.length > 0) return undefined;
  return {connectionId, channel, threadTs};
}

/** Direct message channels carry the agent view, which shows a status. Channels show a reaction. */
export function isSlackAgentViewChannel(channel: string): boolean {
  return channel.startsWith('D');
}
