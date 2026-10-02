import type {RecordedWrite} from '@shipfox/e2e-core';
import {startSlackApiMock} from '@shipfox/e2e-driver-slack';
import {createSlackConnection} from '@shipfox/e2e-setup-integrations';
import type {SlackSeed} from './schema.js';
import type {EventSender} from './senders.js';
import {createSlackEventSender} from './slack-events.js';

export interface SlackWorkspace {
  /** The slug the composed workflow's chat connection uses. */
  connectionSlug: string;
  sender: EventSender;
  /** Every write the Slack fake accepted, as `slack.<method>` entries. Read before it stops. */
  writes: () => RecordedWrite[];
}

/**
 * A Slack connection in the case's workspace, and the fake behind it. The fake serves the seeded
 * thread and records the messages the workflow posts.
 */
export async function arrangeSlackWorkspace({
  workspaceId,
  uniqueId,
  seed,
  cleanups,
}: {
  workspaceId: string;
  uniqueId: string;
  /** The thread to serve. A case whose workflow only posts has none. */
  seed?: SlackSeed | undefined;
  /** Cleanups run in reverse, by the caller, however the run ends. */
  cleanups: Array<() => Promise<void>>;
}): Promise<SlackWorkspace> {
  const botToken = `xoxb-eval-${uniqueId}`;
  const mock = await startSlackApiMock({
    botToken,
    ...(seed === undefined ? {} : {threadPages: {'': {messages: seed.thread}}}),
  });
  cleanups.push(() => mock.stop());

  const teamId = `T${uniqueId}`;
  const connection = await createSlackConnection({
    workspaceId,
    teamId,
    teamName: `Eval Slack ${uniqueId}`,
    appId: `A${uniqueId}`,
    botUserId: `Ubot${uniqueId}`,
    botToken,
    scopes: ['app_mentions:read', 'channels:history', 'chat:write'],
  });

  return {
    connectionSlug: connection.slug,
    sender: createSlackEventSender({teamId}),
    writes: () => mock.writes().map((write) => ({...write, kind: `slack.${write.kind}`})),
  };
}
