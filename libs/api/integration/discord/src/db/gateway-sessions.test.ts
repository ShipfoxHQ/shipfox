import {
  flushDiscordGatewaySession,
  getDiscordGatewaySession,
  startDiscordGatewaySession,
} from './gateway-sessions.js';

function newShardId() {
  return Math.floor(Math.random() * 1_000_000_000);
}

describe('Discord gateway sessions', () => {
  it('returns undefined when the shard has no row', async () => {
    await expect(getDiscordGatewaySession({shardId: newShardId()})).resolves.toBeUndefined();
  });

  it('writes a new session with both cursors at zero', async () => {
    const shardId = newShardId();

    await startDiscordGatewaySession({
      shardId,
      sessionId: 'session-a',
      resumeGatewayUrl: 'wss://resume-a.discord.test',
    });

    await expect(getDiscordGatewaySession({shardId})).resolves.toMatchObject({
      shardId,
      sessionId: 'session-a',
      resumeGatewayUrl: 'wss://resume-a.discord.test',
      receivedSequence: 0,
      committedSequence: 0,
    });
  });

  it('resets the cursors when a new session replaces the stored one', async () => {
    const shardId = newShardId();
    await startDiscordGatewaySession({
      shardId,
      sessionId: 'session-a',
      resumeGatewayUrl: 'wss://resume-a.discord.test',
    });
    await flushDiscordGatewaySession({
      shardId,
      sessionId: 'session-a',
      resumeGatewayUrl: 'wss://resume-a.discord.test',
      receivedSequence: 90,
      committedSequence: 80,
    });

    await startDiscordGatewaySession({
      shardId,
      sessionId: 'session-b',
      resumeGatewayUrl: 'wss://resume-b.discord.test',
    });

    await expect(getDiscordGatewaySession({shardId})).resolves.toMatchObject({
      sessionId: 'session-b',
      receivedSequence: 0,
      committedSequence: 0,
    });
  });

  it('flushes the session fields and both cursors in one write', async () => {
    const shardId = newShardId();
    await startDiscordGatewaySession({
      shardId,
      sessionId: 'session-a',
      resumeGatewayUrl: 'wss://resume-a.discord.test',
    });

    await flushDiscordGatewaySession({
      shardId,
      sessionId: 'session-a',
      resumeGatewayUrl: 'wss://resume-a2.discord.test',
      receivedSequence: 12,
      committedSequence: 10,
    });

    await expect(getDiscordGatewaySession({shardId})).resolves.toMatchObject({
      sessionId: 'session-a',
      resumeGatewayUrl: 'wss://resume-a2.discord.test',
      receivedSequence: 12,
      committedSequence: 10,
    });
  });

  it('keeps the stored cursors when the same session is started again', async () => {
    const shardId = newShardId();
    const params = {
      shardId,
      sessionId: 'session-a',
      resumeGatewayUrl: 'wss://resume-a.discord.test',
    };
    await startDiscordGatewaySession(params);
    await flushDiscordGatewaySession({...params, receivedSequence: 90, committedSequence: 85});

    await startDiscordGatewaySession({...params, resumeGatewayUrl: 'wss://resume-a2.discord.test'});

    await expect(getDiscordGatewaySession({shardId})).resolves.toMatchObject({
      resumeGatewayUrl: 'wss://resume-a2.discord.test',
      receivedSequence: 90,
      committedSequence: 85,
    });
  });

  it('does not create a row on flush', async () => {
    const shardId = newShardId();

    const flushed = await flushDiscordGatewaySession({
      shardId,
      sessionId: 'session-a',
      resumeGatewayUrl: 'wss://resume-a.discord.test',
      receivedSequence: 5,
      committedSequence: 4,
    });

    expect(flushed).toBeUndefined();
    await expect(getDiscordGatewaySession({shardId})).resolves.toBeUndefined();
  });

  it('never lowers the committed cursor within a session', async () => {
    const shardId = newShardId();
    const params = {
      shardId,
      sessionId: 'session-a',
      resumeGatewayUrl: 'wss://resume-a.discord.test',
    };
    await startDiscordGatewaySession(params);
    await flushDiscordGatewaySession({...params, receivedSequence: 20, committedSequence: 18});

    await flushDiscordGatewaySession({...params, receivedSequence: 25, committedSequence: 7});

    await expect(getDiscordGatewaySession({shardId})).resolves.toMatchObject({
      receivedSequence: 25,
      committedSequence: 18,
    });
  });

  it('ignores a late flush from a replaced session', async () => {
    const shardId = newShardId();
    await startDiscordGatewaySession({
      shardId,
      sessionId: 'session-a',
      resumeGatewayUrl: 'wss://resume-a.discord.test',
    });
    await startDiscordGatewaySession({
      shardId,
      sessionId: 'session-b',
      resumeGatewayUrl: 'wss://resume-b.discord.test',
    });

    const flushed = await flushDiscordGatewaySession({
      shardId,
      sessionId: 'session-a',
      resumeGatewayUrl: 'wss://resume-a.discord.test',
      receivedSequence: 50,
      committedSequence: 50,
    });

    expect(flushed).toBeUndefined();
    await expect(getDiscordGatewaySession({shardId})).resolves.toMatchObject({
      sessionId: 'session-b',
      resumeGatewayUrl: 'wss://resume-b.discord.test',
      receivedSequence: 0,
      committedSequence: 0,
    });
  });

  it('clears the session and both cursors when the session id is null', async () => {
    const shardId = newShardId();
    await startDiscordGatewaySession({
      shardId,
      sessionId: 'session-a',
      resumeGatewayUrl: 'wss://resume-a.discord.test',
    });
    await flushDiscordGatewaySession({
      shardId,
      sessionId: 'session-a',
      resumeGatewayUrl: 'wss://resume-a.discord.test',
      receivedSequence: 9,
      committedSequence: 9,
    });

    await flushDiscordGatewaySession({
      shardId,
      sessionId: null,
      resumeGatewayUrl: null,
      receivedSequence: null,
      committedSequence: null,
    });

    await expect(getDiscordGatewaySession({shardId})).resolves.toMatchObject({
      sessionId: null,
      resumeGatewayUrl: null,
      receivedSequence: null,
      committedSequence: null,
    });
  });
});
