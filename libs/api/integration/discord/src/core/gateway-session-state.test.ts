import type {SessionInfo} from '@discordjs/ws';
import type {DiscordGatewaySession} from '#db/gateway-sessions.js';
import {ContiguousMark, GatewaySessionState} from './gateway-session-state.js';

function sessionInfo(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId: 'session-a',
    resumeURL: 'wss://resume-a.discord.test',
    sequence: 1,
    shardCount: 1,
    shardId: 0,
    ...overrides,
  };
}

function storedSession(overrides: Partial<DiscordGatewaySession> = {}): DiscordGatewaySession {
  return {
    shardId: 0,
    sessionId: 'stored-session',
    resumeGatewayUrl: 'wss://stored.discord.test',
    receivedSequence: 50,
    committedSequence: 40,
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ContiguousMark', () => {
  it('advances one sequence at a time', () => {
    const mark = new ContiguousMark();

    mark.handled(1);
    mark.handled(2);

    expect(mark.value).toBe(2);
  });

  it('keeps the mark below a gap until it is filled', () => {
    const mark = new ContiguousMark();

    mark.handled(2);
    expect(mark.value).toBe(0);
    mark.handled(3);
    expect(mark.value).toBe(0);
    mark.handled(1);

    expect(mark.value).toBe(3);
  });

  it('ignores a sequence at or below the mark', () => {
    const mark = new ContiguousMark(10);

    expect(mark.handled(7)).toBe(false);
    expect(mark.handled(10)).toBe(false);
    expect(mark.value).toBe(10);
  });

  it('forgets handled sequences above the mark on reset', () => {
    const mark = new ContiguousMark();
    mark.handled(5);

    mark.reset(0);
    mark.handled(1);

    expect(mark.value).toBe(1);
  });
});

describe('GatewaySessionState', () => {
  it('resumes from the committed mark, never the received sequence', () => {
    const state = new GatewaySessionState({stored: storedSession(), onSessionChange: vi.fn()});

    expect(state.retrieve(0)).toEqual({
      sessionId: 'stored-session',
      resumeURL: 'wss://stored.discord.test',
      sequence: 40,
      shardCount: 1,
      shardId: 0,
    });
  });

  it('has no session to resume without a stored one', () => {
    const state = new GatewaySessionState({stored: undefined, onSessionChange: vi.fn()});

    expect(state.retrieve(0)).toBeNull();
  });

  it('records the received sequence without moving the committed mark', () => {
    const state = new GatewaySessionState({stored: storedSession(), onSessionChange: vi.fn()});

    state.update(0, sessionInfo({sessionId: 'stored-session', sequence: 60}));

    expect(state.snapshot()).toMatchObject({receivedSequence: 60, committedSequence: 40});
  });

  it('resets the mark and reports a change when a new session starts', () => {
    const onSessionChange = vi.fn();
    const state = new GatewaySessionState({stored: storedSession(), onSessionChange});
    const epoch = state.epoch;

    state.update(0, sessionInfo({sessionId: 'new-session', sequence: 1}));

    expect(state.snapshot()).toEqual({
      sessionId: 'new-session',
      resumeGatewayUrl: 'wss://resume-a.discord.test',
      receivedSequence: 1,
      committedSequence: 0,
    });
    expect(state.epoch).toBe(epoch + 1);
    expect(onSessionChange).toHaveBeenCalledTimes(1);
  });

  it('clears the session when the library reports null', () => {
    const onSessionChange = vi.fn();
    const state = new GatewaySessionState({stored: storedSession(), onSessionChange});

    state.update(0, null);

    expect(state.retrieve(0)).toBeNull();
    expect(onSessionChange).toHaveBeenCalledTimes(1);
  });

  it('keeps the session when the null comes from our own destroy', async () => {
    const onSessionChange = vi.fn();
    const state = new GatewaySessionState({stored: storedSession(), onSessionChange});

    await state.keepingSession(() => {
      state.update(0, null);
      return Promise.resolve();
    });

    expect(state.retrieve(0)).toMatchObject({sessionId: 'stored-session', sequence: 40});
    expect(onSessionChange).not.toHaveBeenCalled();
  });

  it('keeps clearing sessions again after our own destroy ends', async () => {
    const state = new GatewaySessionState({stored: storedSession(), onSessionChange: vi.fn()});
    await state.keepingSession(() => Promise.resolve());

    state.update(0, null);

    expect(state.retrieve(0)).toBeNull();
  });

  it('keeps the mark contiguous when READY is committed after GUILD_CREATE', () => {
    const state = new GatewaySessionState({stored: undefined, onSessionChange: vi.fn()});
    state.update(0, sessionInfo({sequence: 1}));
    const {epoch} = state;

    state.commit({sequence: 2, epoch});
    expect(state.snapshot().committedSequence).toBe(0);
    state.commit({sequence: 1, epoch});

    expect(state.snapshot().committedSequence).toBe(2);
  });

  it('ignores a commit from an earlier session', () => {
    const state = new GatewaySessionState({stored: storedSession(), onSessionChange: vi.fn()});
    const staleEpoch = state.epoch;
    state.update(0, sessionInfo({sessionId: 'new-session', sequence: 1}));

    state.commit({sequence: 1, epoch: staleEpoch});

    expect(state.snapshot().committedSequence).toBe(0);
  });
});
