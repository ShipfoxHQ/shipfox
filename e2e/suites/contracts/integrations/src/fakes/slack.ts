import {type SlackChannelSeed, startSlackApiMock} from '@shipfox/e2e-driver-slack';
import {
  type ContractFakeAdapter,
  ephemeralEndpoint,
  rejectingSeed,
  requiredField,
  type SandboxFixtures,
} from './shared.js';

/** What the Slack tool adapter needs to act as the connection's bot. */
export interface SlackContractAccess {
  botToken: string;
}

// The sandbox read channel holds about 20 messages, so a case that passes a small `limit` gets a
// cursor. The fixtures name only the messages cases read, and the rest fill the channel.
const SLACK_READ_CHANNEL_MESSAGES = 20;
const SLACK_FILLER_BASE_TS = 1_791_220_000;

function slackField({
  fixtures,
  fixtureName,
  name,
}: {
  fixtures: SandboxFixtures;
  fixtureName: string;
  name: string;
}): string {
  const fixture = fixtures[fixtureName];
  if (fixture === undefined) throw new Error(`The slack manifest has no "${fixtureName}" fixture.`);
  return String(requiredField({provider: 'slack', fixture, fixtureName, name}));
}

interface SlackSeeds {
  user?: {id: string} & Record<string, unknown>;
  channels: SlackChannelSeed[];
  thread?: {channel: string; ts: string; messages: Record<string, unknown>[]};
}

/** What the Slack fake serves for the sandbox fixtures, with `botUserId` as a member of each channel. */
function slackSeeds({
  fixtures,
  botUserId,
  teamId,
}: {
  fixtures: SandboxFixtures;
  botUserId: string;
  teamId: string;
}): SlackSeeds {
  const field = (fixtureName: string, name: string) => slackField({fixtures, fixtureName, name});
  const userId = fixtures.user === undefined ? undefined : field('user', 'id');
  const members = userId === undefined ? [botUserId] : [userId, botUserId];
  const seeds: SlackSeeds = {channels: []};
  if (userId !== undefined) {
    seeds.user = {
      id: userId,
      team_id: teamId,
      name: 'contract-user',
      real_name: 'Contract User',
      deleted: false,
      is_bot: false,
      profile: {real_name: 'Contract User', display_name: 'contract-user'},
    };
  }
  if (fixtures.write_channel !== undefined) {
    seeds.channels.push({
      id: field('write_channel', 'id'),
      name: field('write_channel', 'name'),
      members,
    });
  }
  if (fixtures.read_channel === undefined) return seeds;

  const channelId = field('read_channel', 'id');
  const message = ({text, ts}: {text: string; ts: string}) => ({
    type: 'message',
    user: userId ?? botUserId,
    text,
    ts,
    team: teamId,
  });
  const messages: Record<string, unknown>[] = [];
  if (fixtures.thread !== undefined) {
    const ts = field('thread', 'ts');
    messages.push({
      ...message({text: field('thread', 'text'), ts}),
      thread_ts: ts,
      reply_count: 2,
      reply_users: members.slice(0, 1),
      reply_users_count: 1,
    });
    const reply = ({text, replyTs}: {text: string; replyTs: string}) => ({
      ...message({text, ts: replyTs}),
      thread_ts: ts,
    });
    seeds.thread = {
      channel: channelId,
      ts,
      messages: [
        ...messages,
        reply({text: 'Contract fixture reply 1', replyTs: field('thread', 'reply_ts')}),
        reply({text: 'Contract fixture reply 2', replyTs: field('thread', 'last_reply_ts')}),
      ],
    };
  }
  if (fixtures.reaction_message !== undefined) {
    messages.push({
      ...message({
        text: 'Contract fixture message with a reaction',
        ts: field('reaction_message', 'ts'),
      }),
      reactions: [{name: 'white_check_mark', count: 1, users: members.slice(0, 1)}],
    });
  }
  if (fixtures.unicode_message !== undefined) {
    messages.push(
      message({
        text: 'Contract fixture message: café, 日本語, 🎉',
        ts: field('unicode_message', 'ts'),
      }),
    );
  }
  for (let index = messages.length; index < SLACK_READ_CHANNEL_MESSAGES; index += 1) {
    messages.push(
      message({
        text: `Contract fixture message ${index + 1}`,
        ts: `${SLACK_FILLER_BASE_TS + index}.000100`,
      }),
    );
  }
  seeds.channels.push({
    id: channelId,
    name: field('read_channel', 'name'),
    members,
    messages,
  });
  return seeds;
}

/**
 * Slack, behind a bot token the fake answers for. It seeds the `read_channel` and `write_channel`
 * fixtures as channels, with the `user` fixture and the bot as their members. The read channel
 * holds the `thread` root, the `reaction_message`, the `unicode_message`, and filler up to about
 * 20 messages. The `thread` fixture has a parent and two replies, and `user` is a workspace user.
 */
export const slackContractFake: ContractFakeAdapter<SlackContractAccess> = async ({
  uniqueId,
  cleanups,
}) => {
  const botToken = `xoxb-contracts-${uniqueId}`;
  const botUserId = `Ubot${uniqueId}`;
  const teamId = `T${uniqueId}`;
  const mock = await startSlackApiMock({botToken, botUserId, endpoint: ephemeralEndpoint()});
  cleanups.push(() => mock.stop());
  return {
    env: {SLACK_API_BASE_URL: mock.endpoint.toString()},
    access: {botToken},
    seed: (fixtures) =>
      rejectingSeed(() => {
        const seeds = slackSeeds({fixtures, botUserId, teamId});
        if (seeds.user !== undefined) mock.seedUser(seeds.user);
        for (const channel of seeds.channels) mock.seedChannel(channel);
        if (seeds.thread !== undefined) mock.seedThread(seeds.thread);
      }),
    writes: () => mock.writes().map((write) => ({...write, kind: `slack.${write.kind}`})),
  };
};
