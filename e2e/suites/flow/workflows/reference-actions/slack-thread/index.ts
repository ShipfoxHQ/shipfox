import {mkdir, rename, rm, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {type ActionLog, defineAction, ToolCallError, type Tools} from '@shipfox/actions';
import {compareTs, renderThread, type SlackMessage} from './markdown.ts';

declare module '@shipfox/actions' {
  interface Aliases {
    slack: 'slack';
  }
}

type Inputs = {
  channel_id: string;
  thread_ts: string;
  destination: string;
};

interface ThreadPage {
  messages?: SlackMessage[];
  response_metadata?: {next_cursor?: string};
}

export default defineAction<Inputs>(async ({inputs, tools, log, signal}) => {
  // Pages can overlap when replies arrive during the export, so messages are keyed by timestamp.
  const byTs = new Map<string, SlackMessage>();
  let cursor: string | undefined;
  do {
    const page = await tools.slack.call(
      'read_thread',
      {
        channel_id: inputs.channel_id,
        message_ts: inputs.thread_ts,
        limit: 200,
        ...(cursor === undefined ? {} : {cursor}),
      },
      {signal},
    );
    const body = page.structured as ThreadPage;
    for (const message of body.messages ?? []) byTs.set(message.ts, message);
    cursor = body.response_metadata?.next_cursor || undefined;
  } while (cursor !== undefined);

  const messages = [...byTs.values()].sort((left, right) => compareTs(left.ts, right.ts));
  const expectedReplies = byTs.get(inputs.thread_ts)?.reply_count;
  const complete = expectedReplies === undefined || messages.length - 1 >= expectedReplies;
  log.info(`Collected ${messages.length} messages from ${inputs.channel_id}`);

  const authors = await lookUpAuthors({tools, messages, log, signal});
  const permalinks = await lookUpPermalinks({
    tools,
    channelId: inputs.channel_id,
    messages,
    signal,
  });
  const markdown = renderThread({
    channelId: inputs.channel_id,
    threadTs: inputs.thread_ts,
    retrievedAt: new Date(),
    messages,
    authors,
    permalinks,
    complete,
    expectedReplies,
  });

  // A failed run must never leave a file that looks complete, so the file appears only once whole.
  const destination = inputs.destination;
  const temporary = `${destination}.tmp`;
  await mkdir(dirname(destination), {recursive: true});
  try {
    await writeFile(temporary, markdown);
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, {force: true});
    throw error;
  }
  return {path: destination, message_count: messages.length, complete};
});

async function lookUpAuthors(params: {
  tools: Tools;
  messages: SlackMessage[];
  log: ActionLog;
  signal: AbortSignal;
}): Promise<Map<string, string>> {
  const authors = new Map<string, string>();
  const userIds = new Set(params.messages.flatMap((message) => message.user ?? []));
  for (const userId of userIds) {
    try {
      const result = await params.tools.slack.call(
        'read_user_profile',
        {user_id: userId},
        {signal: params.signal},
      );
      const {user} = result.structured as {user?: SlackUser};
      authors.set(userId, displayName(user) ?? userId);
    } catch (error) {
      if (!(error instanceof ToolCallError)) throw error;
      // The message stays in the export, credited to the bare user ID.
      params.log.warn(`Could not look up Slack user ${userId}: ${error.message}`);
    }
  }
  return authors;
}

async function lookUpPermalinks(params: {
  tools: Tools;
  channelId: string;
  messages: SlackMessage[];
  signal: AbortSignal;
}): Promise<Map<string, string>> {
  const permalinks = new Map<string, string>();
  for (const message of params.messages) {
    try {
      const result = await params.tools.slack.call(
        'get_permalink',
        {channel_id: params.channelId, message_ts: message.ts},
        {signal: params.signal},
      );
      const {permalink} = result.structured as {permalink?: string};
      if (permalink !== undefined) permalinks.set(message.ts, permalink);
    } catch (error) {
      if (!(error instanceof ToolCallError)) throw error;
    }
  }
  return permalinks;
}

interface SlackUser {
  name?: string;
  real_name?: string;
  profile?: {display_name?: string; real_name?: string};
}

function displayName(user: SlackUser | undefined): string | undefined {
  return user?.profile?.display_name || user?.profile?.real_name || user?.real_name || user?.name;
}
