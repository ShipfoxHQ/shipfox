import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {discordContractFake} from './discord.js';
import {CONTRACT_FAKE_ADAPTERS} from './index.js';
import type {SandboxFixtures} from './shared.js';

const discordNeedsChannelPattern = /need a read_channel fixture/u;

describe('discordContractFake', () => {
  const fixtures: SandboxFixtures = {
    read_channel: {id: '1000000000000000001', name: 'contract-test-read'},
    message: {id: '1000000000000000002', content: 'Contract test read message'},
    thread: {id: '1000000000000000003', name: 'Contract test thread'},
    write_channel: {id: '1000000000000000005', name: 'contract-test-write'},
    user: {id: '1000000000000000004', username: 'sandbox_user'},
  };
  let cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    cleanups = [];
  });

  async function arrange() {
    const fake = await discordContractFake({uniqueId: 'abc123', cleanups});
    const endpoint = fake.env.DISCORD_API_BASE_URL;
    if (endpoint === undefined) throw new Error('The Discord fake has no DISCORD_API_BASE_URL.');
    const get = async (path: string) => {
      const response = await fetch(new URL(path, endpoint));
      return {status: response.status, body: (await response.json()) as Record<string, unknown>};
    };
    return {fake, guildId: fake.access.guildId, get};
  }

  it('serves the read channel, its thread, and its message with the fixture ids', async () => {
    const {fake, guildId, get} = await arrange();

    await fake.seed(fixtures);

    expect((await get('/channels/1000000000000000001')).body).toMatchObject({
      type: 0,
      guild_id: guildId,
      name: 'contract-test-read',
    });
    expect((await get('/channels/1000000000000000003')).body).toMatchObject({
      type: 11,
      guild_id: guildId,
      parent_id: '1000000000000000001',
      name: 'Contract test thread',
    });
    expect(
      (await get('/channels/1000000000000000001/messages/1000000000000000002')).body,
    ).toMatchObject({
      content: 'Contract test read message',
      author: {id: '1000000000000000004', username: 'sandbox_user'},
    });
  });

  it('serves the channels, the message search, and the member of the sandbox server', async () => {
    const {fake, guildId, get} = await arrange();

    await fake.seed(fixtures);

    const channels = await get(`/guilds/${guildId}/channels`);
    const search = await get(
      `/guilds/${guildId}/messages/search?content=read%20message&channel_id=1000000000000000001`,
    );
    const member = await get(`/guilds/${guildId}/members/1000000000000000004`);
    expect(channels.body).toMatchObject([
      {id: '1000000000000000005', name: 'contract-test-write'},
      {id: '1000000000000000001', name: 'contract-test-read'},
    ]);
    expect(search.body).toMatchObject({
      total_results: 1,
      messages: [[{id: '1000000000000000002', hit: true}]],
    });
    expect(member.body).toMatchObject({
      user: {id: '1000000000000000004', username: 'sandbox_user'},
    });
  });

  it('seeds nothing for a manifest without Discord fixtures', async () => {
    const {fake, get} = await arrange();

    await fake.seed({});

    expect((await get('/channels/1000000000000000001')).status).toBe(404);
  });

  it('rejects a message or a thread without a read channel', async () => {
    const {fake} = await arrange();

    await expect(fake.seed({message: fixtures.message ?? {}})).rejects.toThrow(
      discordNeedsChannelPattern,
    );
    await expect(fake.seed({thread: fixtures.thread ?? {}})).rejects.toThrow(
      discordNeedsChannelPattern,
    );
  });

  it('is the adapter of the discord provider', () => {
    expect(CONTRACT_FAKE_ADAPTERS.discord).toBe(discordContractFake);
  });
});
