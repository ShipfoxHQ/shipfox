import {createHmac} from 'node:crypto';
import {SlackInstallStateError} from './errors.js';
import {signSlackInstallState, verifySlackInstallState} from './state.js';

describe('Slack install state', () => {
  it('round-trips signed workspace and user claims', () => {
    const state = signSlackInstallState({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      nonce: 'nonce-1',
      now: new Date('2026-07-07T12:00:00.000Z'),
    });

    const result = verifySlackInstallState(state, new Date('2026-07-07T12:05:00.000Z'));

    expect(result).toEqual({workspaceId: 'workspace-1', userId: 'user-1'});
  });

  it.each(['tampered signature', 'expired state'])('rejects a %s', (kind) => {
    const state = signSlackInstallState({
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

    const result = () => verifySlackInstallState(input, now);

    expect(result).toThrow(SlackInstallStateError);
  });

  it('rejects a validly signed malformed payload', () => {
    const payload = Buffer.from('not-json').toString('base64url');
    const signature = createHmac('sha256', 'test-client-secret')
      .update(payload)
      .digest('base64url');

    const result = () => verifySlackInstallState(`${payload}.${signature}`);

    expect(result).toThrow('Invalid Slack install state payload');
  });
});
