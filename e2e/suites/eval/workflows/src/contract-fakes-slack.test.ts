import type {createApiClient} from '@shipfox/e2e-core';
import type {SlackApiMock} from '@shipfox/e2e-driver-slack';
import {afterEach, describe, expect, it, vi} from '@shipfox/vitest/vi';
import {
  CONTRACT_FAKE_ADAPTERS,
  createSlackContractFake,
  type SandboxFixtures,
  slackContractFake,
} from './contract-fakes.js';

const fixtures: SandboxFixtures = {
  read_channel: {id: 'C1', name: 'contracts-read'},
  write_channel: {id: 'C2', name: 'contracts-write'},
  user: {id: 'U1'},
  thread: {
    text: 'Thread root',
    ts: '1791226001.009789',
    reply_ts: '1791226033.1',
    last_reply_ts: '1791226036.2',
  },
  reaction_message: {ts: '1791226072.112799'},
  unicode_message: {ts: '1791226138.522499'},
};

const missingTextPattern = /The slack fixture "thread" has no "text"/u;

describe('slackContractFake', () => {
  const cleanups: Array<() => Promise<void>> = [];
  const seeded = {seedChannel: vi.fn(), seedUser: vi.fn(), seedThread: vi.fn()};
  const stop = vi.fn(() => Promise.resolve());
  const startMock = vi.fn((_options: {botToken: string}) =>
    Promise.resolve({...seeded, stop, writes: () => []} as unknown as SlackApiMock),
  );
  const createConnection = vi.fn(
    (_params: {workspaceId: string; botToken: string; botUserId: string}) =>
      Promise.resolve({slug: 'slack_fake'}),
  );
  const adapter = createSlackContractFake({
    startMock,
    createConnection: createConnection as never,
  });

  afterEach(async () => {
    vi.clearAllMocks();
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  function arrange() {
    return adapter({
      workspaceId: 'workspace-1',
      uniqueId: 'abc',
      github: {mock: {} as never, connectionId: 'connection-1', connectionSlug: 'github_fake'},
      client: {} as unknown as ReturnType<typeof createApiClient>,
      cleanups,
    });
  }

  it('connects the workspace to the fake behind its own bot token', async () => {
    const fake = await arrange();

    expect(fake.connectionSlug).toBe('slack_fake');
    expect(startMock).toHaveBeenCalledWith({botToken: 'xoxb-contracts-abc'});
    expect(createConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        botToken: 'xoxb-contracts-abc',
        botUserId: 'Ubotabc',
      }),
    );
    await cleanups.pop()?.();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('seeds the read channel with the fixture messages, a full first page, and the thread', async () => {
    const fake = await arrange();

    await fake.seed(fixtures);

    const read = seeded.seedChannel.mock.calls
      .map(([channel]) => channel)
      .find((channel) => channel.id === 'C1');
    expect(read).toMatchObject({name: 'contracts-read', members: ['U1', 'Ubotabc']});
    expect(read?.messages).toHaveLength(20);
    expect(read?.messages?.map((message: Record<string, unknown>) => message.ts)).toEqual(
      expect.arrayContaining(['1791226001.009789', '1791226072.112799', '1791226138.522499']),
    );
    expect(
      read?.messages?.find(
        (message: Record<string, unknown>) => message.ts === '1791226001.009789',
      ),
    ).toMatchObject({
      text: 'Thread root',
      reply_count: 2,
    });
    expect(seeded.seedChannel).toHaveBeenCalledWith(
      expect.objectContaining({id: 'C2', name: 'contracts-write'}),
    );
    expect(seeded.seedUser).toHaveBeenCalledWith(expect.objectContaining({id: 'U1'}));
    expect(seeded.seedThread).toHaveBeenCalledWith({
      channel: 'C1',
      ts: '1791226001.009789',
      messages: [
        expect.objectContaining({ts: '1791226001.009789', text: 'Thread root'}),
        expect.objectContaining({ts: '1791226033.1', thread_ts: '1791226001.009789'}),
        expect.objectContaining({ts: '1791226036.2', thread_ts: '1791226001.009789'}),
      ],
    });
  });

  it('seeds nothing for a manifest without Slack fixtures', async () => {
    const fake = await arrange();

    await fake.seed({});

    expect(seeded.seedChannel).not.toHaveBeenCalled();
    expect(seeded.seedUser).not.toHaveBeenCalled();
    expect(seeded.seedThread).not.toHaveBeenCalled();
  });

  it('names Slack when a fixture lacks a field', async () => {
    const fake = await arrange();

    await expect(
      fake.seed({read_channel: {id: 'C1', name: 'contracts-read'}, thread: {ts: '1.000100'}}),
    ).rejects.toThrow(missingTextPattern);
  });

  it('is the adapter of the slack provider', () => {
    expect(CONTRACT_FAKE_ADAPTERS.slack).toBe(slackContractFake);
  });
});
