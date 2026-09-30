import {createHmac} from 'node:crypto';
import {DiscordInstallStateError} from './errors.js';
import {signDiscordInstallState, verifyDiscordInstallState} from './state.js';

describe('Discord install state', () => {
  it('round-trips signed workspace and user claims', () => {
    const state = signDiscordInstallState({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      nonce: 'nonce-1',
      now: new Date('2026-07-07T12:00:00.000Z'),
    });

    const result = verifyDiscordInstallState(state, new Date('2026-07-07T12:05:00.000Z'));

    expect(result).toEqual({workspaceId: 'workspace-1', userId: 'user-1'});
  });

  it.each(['tampered signature', 'expired state'])('rejects a %s', (kind) => {
    const state = signDiscordInstallState({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      nonce: 'nonce-1',
      now: new Date('2026-07-07T12:00:00.000Z'),
    });
    const [payload] = state.split('.');
    const input = kind === 'tampered signature' ? `${payload}.tampered` : state;
    const now =
      kind === 'expired state'
        ? new Date('2026-07-07T12:31:00.000Z')
        : new Date('2026-07-07T12:05:00.000Z');

    const result = () => verifyDiscordInstallState(input, now);

    expect(result).toThrow(DiscordInstallStateError);
  });

  it.each(['no-dot', 'a.b.c'])('rejects the malformed state %s', (state) => {
    const result = () => verifyDiscordInstallState(state);

    expect(result).toThrow(DiscordInstallStateError);
  });

  it('rejects a validly signed malformed payload', () => {
    const payload = Buffer.from('not-json').toString('base64url');
    const signature = createHmac('sha256', 'test-discord-client-secret')
      .update(payload)
      .digest('base64url');

    const result = () => verifyDiscordInstallState(`${payload}.${signature}`);

    expect(result).toThrow('Invalid Discord install state payload');
  });
});
