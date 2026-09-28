export interface SlackFile {
  name?: string;
  title?: string;
  permalink?: string;
}

export interface SlackMessage {
  ts: string;
  user?: string;
  username?: string;
  text?: string;
  reply_count?: number;
  files?: SlackFile[];
}

export interface ThreadExport {
  channelId: string;
  threadTs: string;
  retrievedAt: Date;
  messages: SlackMessage[];
  authors: ReadonlyMap<string, string>;
  permalinks: ReadonlyMap<string, string>;
  complete: boolean;
  expectedReplies: number | undefined;
}

/** Orders Slack timestamps (`seconds.micros`) without losing precision to floats. */
export function compareTs(left: string, right: string): number {
  const [leftSeconds = '', leftMicros = ''] = left.split('.');
  const [rightSeconds = '', rightMicros = ''] = right.split('.');
  return (
    Number(leftSeconds) - Number(rightSeconds) ||
    leftMicros.padEnd(6, '0').localeCompare(rightMicros.padEnd(6, '0'))
  );
}

export function renderThread(thread: ThreadExport): string {
  const replies = thread.messages.length - 1;
  const completeness = thread.complete
    ? `Complete: ${thread.messages.length} messages, the parent and ${replies} replies.`
    : `Incomplete: ${replies} of ${thread.expectedReplies} replies retrieved.`;
  const lines = [
    `# Slack thread ${thread.channelId} ${thread.threadTs}`,
    '',
    `Retrieved ${thread.retrievedAt.toISOString()}. ${completeness}`,
  ];
  for (const message of thread.messages) {
    lines.push('', '---', '', ...renderMessage(message, thread));
  }
  return `${lines.join('\n')}\n`;
}

function renderMessage(message: SlackMessage, thread: ThreadExport): string[] {
  const author = authorName(message, thread.authors);
  const heading = `## ${author}, ${slackTime(message.ts)}`;
  const permalink = thread.permalinks.get(message.ts);
  const lines = [
    heading,
    '',
    permalink === undefined ? `ts ${message.ts}` : `[ts ${message.ts}](${permalink})`,
  ];
  lines.push('', message.text?.trim() || '_No text._');
  for (const file of message.files ?? []) {
    const name = file.title ?? file.name ?? 'file';
    lines.push(
      '',
      file.permalink === undefined ? `File: ${name}` : `File: [${name}](${file.permalink})`,
    );
  }
  return lines;
}

function authorName(message: SlackMessage, authors: ReadonlyMap<string, string>): string {
  if (message.user !== undefined) return authors.get(message.user) ?? message.user;
  return message.username ?? 'unknown author';
}

function slackTime(ts: string): string {
  const seconds = Number(ts.split('.')[0]);
  return new Date(seconds * 1000).toISOString().replace('.000Z', 'Z');
}
