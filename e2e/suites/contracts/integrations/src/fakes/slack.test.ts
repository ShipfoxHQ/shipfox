import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {CONTRACT_FAKE_ADAPTERS} from './index.js';
import type {ContractFake, SandboxFixtures} from './shared.js';
import {type SlackContractAccess, slackContractFake} from './slack.js';

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

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  function arrange() {
    return slackContractFake({uniqueId: 'abc', cleanups});
  }

  async function call({
    fake,
    method,
    params,
  }: {
    fake: ContractFake<SlackContractAccess>;
    method: string;
    params: Record<string, string>;
  }) {
    const baseUrl = fake.env.SLACK_API_BASE_URL;
    if (baseUrl === undefined) throw new Error('The Slack fake has no SLACK_API_BASE_URL.');
    const response = await fetch(new URL(method, baseUrl), {
      method: 'POST',
      headers: {authorization: `Bearer ${fake.access.botToken}`},
      body: new URLSearchParams(params),
    });
    return (await response.json()) as Record<string, unknown>;
  }

  it('serves the fake behind its own bot token, and stops it with the run cleanups', async () => {
    const fake = await arrange();

    expect(fake.access).toEqual({botToken: 'xoxb-contracts-abc'});
    expect(fake.env.SLACK_API_BASE_URL).toEqual(expect.any(String));
    await cleanups.pop()?.();
    await expect(call({fake, method: 'users.info', params: {user: 'U1'}})).rejects.toThrow();
  });

  it('seeds the read channel with the fixture messages, a full first page, and the thread', async () => {
    const fake = await arrange();

    await fake.seed(fixtures);

    const members = await call({fake, method: 'conversations.members', params: {channel: 'C1'}});
    expect(members).toMatchObject({ok: true, members: ['U1', 'Ubotabc']});
    expect(await call({fake, method: 'conversations.info', params: {channel: 'C1'}})).toMatchObject(
      {ok: true, channel: {id: 'C1', name: 'contracts-read'}},
    );
    const history = (await call({
      fake,
      method: 'conversations.history',
      params: {channel: 'C1', limit: '100'},
    })) as {messages: Array<Record<string, unknown>>};
    expect(history.messages).toHaveLength(20);
    expect(history.messages.map((message) => message.ts)).toEqual(
      expect.arrayContaining(['1791226001.009789', '1791226072.112799', '1791226138.522499']),
    );
    expect(history.messages.find((message) => message.ts === '1791226001.009789')).toMatchObject({
      text: 'Thread root',
      reply_count: 2,
    });
    expect(await call({fake, method: 'conversations.info', params: {channel: 'C2'}})).toMatchObject(
      {ok: true, channel: {id: 'C2', name: 'contracts-write'}},
    );
    expect(await call({fake, method: 'users.info', params: {user: 'U1'}})).toMatchObject({
      ok: true,
      user: {id: 'U1'},
    });
    expect(
      await call({
        fake,
        method: 'conversations.replies',
        params: {channel: 'C1', ts: '1791226001.009789'},
      }),
    ).toMatchObject({
      ok: true,
      messages: [
        {ts: '1791226001.009789', text: 'Thread root'},
        {ts: '1791226033.1', thread_ts: '1791226001.009789'},
        {ts: '1791226036.2', thread_ts: '1791226001.009789'},
      ],
    });
  });

  it('seeds nothing for a manifest without Slack fixtures', async () => {
    const fake = await arrange();

    await fake.seed({});

    expect(await call({fake, method: 'conversations.list', params: {}})).toMatchObject({
      ok: true,
      channels: [],
    });
    expect(await call({fake, method: 'users.info', params: {user: 'U1'}})).toMatchObject({
      ok: false,
      error: 'user_not_found',
    });
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
