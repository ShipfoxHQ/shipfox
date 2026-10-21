import {type DiscordApiMock, startDiscordApiMock} from '@shipfox/e2e-driver-discord';
import {
  type ContractFakeAdapter,
  ephemeralEndpoint,
  field,
  rejectingSeed,
  requiredField,
  type SandboxFixtures,
} from './shared.js';

/** What the Discord tool adapter needs to act in the connection's server. */
export interface DiscordContractAccess {
  guildId: string;
}

// The server the fake seeds its channels and members under. No case pins it: it only shows in the
// `url` of a result.
const CONTRACTS_GUILD_ID = '2000000000000000001';

// Discord's channel types: a text channel and a public thread.
const TEXT_CHANNEL = 0;
const PUBLIC_THREAD = 11;

/** Loads the fixtures the Discord cases read into the fake, under the connection's server. */
export function seedDiscord({
  discord,
  guildId,
  fixtures,
}: {
  discord: DiscordApiMock;
  guildId: string;
  fixtures: SandboxFixtures;
}): void {
  const {read_channel: channel, write_channel: writeChannel, thread, message, user} = fixtures;
  if (channel === undefined && (message !== undefined || thread !== undefined)) {
    throw new Error('The discord message and thread fixtures need a read_channel fixture.');
  }
  if (writeChannel !== undefined) {
    discord.addChannel({
      id: String(
        requiredField({
          provider: 'discord',
          fixture: writeChannel,
          fixtureName: 'write_channel',
          name: 'id',
        }),
      ),
      type: TEXT_CHANNEL,
      guild_id: guildId,
      name: String(field({fixture: writeChannel, name: 'name'}) ?? 'contract-test-write'),
    });
  }
  const author =
    user === undefined
      ? {id: '1', username: 'user'}
      : {
          id: String(
            requiredField({provider: 'discord', fixture: user, fixtureName: 'user', name: 'id'}),
          ),
          username: String(field({fixture: user, name: 'username'}) ?? 'user'),
        };
  if (user !== undefined) discord.addMember({guildId, member: {user: author}});
  if (channel === undefined) return;
  const channelId = String(
    requiredField({provider: 'discord', fixture: channel, fixtureName: 'read_channel', name: 'id'}),
  );
  discord.addChannel({
    id: channelId,
    type: TEXT_CHANNEL,
    guild_id: guildId,
    name: String(field({fixture: channel, name: 'name'}) ?? 'contract-test-read'),
  });
  if (thread !== undefined) {
    discord.addChannel({
      id: String(
        requiredField({provider: 'discord', fixture: thread, fixtureName: 'thread', name: 'id'}),
      ),
      type: PUBLIC_THREAD,
      guild_id: guildId,
      parent_id: channelId,
      name: String(field({fixture: thread, name: 'name'}) ?? 'Contract test thread'),
    });
  }
  if (message !== undefined) {
    discord.addMessage({
      id: String(
        requiredField({provider: 'discord', fixture: message, fixtureName: 'message', name: 'id'}),
      ),
      channel_id: channelId,
      content: String(field({fixture: message, name: 'content'}) ?? ''),
      author,
    });
  }
}

/**
 * Discord. It seeds the `read_channel` and `write_channel` fixtures as text channels, the `thread`
 * fixture as a thread in the read channel, the `message` fixture as a message of the read channel,
 * and the `user` fixture as a member of the server.
 */
export const discordContractFake: ContractFakeAdapter<DiscordContractAccess> = async ({
  cleanups,
}) => {
  const discord = await startDiscordApiMock({endpoint: ephemeralEndpoint()});
  cleanups.push(() => discord.stop());
  const guildId = CONTRACTS_GUILD_ID;
  return {
    env: {DISCORD_API_BASE_URL: discord.endpoint.toString()},
    access: {guildId},
    seed: (fixtures) => rejectingSeed(() => seedDiscord({discord, guildId, fixtures})),
    writes: () => discord.writes(),
  };
};
