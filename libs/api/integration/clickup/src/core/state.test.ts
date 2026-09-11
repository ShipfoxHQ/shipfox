import {ClickUpInstallStateError} from './errors.js';
import {signClickUpInstallState, verifyClickUpInstallState} from './state.js';

describe('ClickUp install state', () => {
  it('round-trips signed workspace and user claims', () => {
    const state = signClickUpInstallState({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      nonce: 'nonce-1',
      now: new Date('2026-07-07T12:00:00.000Z'),
    });

    const result = verifyClickUpInstallState(state, new Date('2026-07-07T12:05:00.000Z'));

    expect(result).toEqual({workspaceId: 'workspace-1', userId: 'user-1'});
  });

  it('rejects a tampered or expired state', () => {
    const state = signClickUpInstallState({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      nonce: 'nonce-1',
      now: new Date('2026-07-07T12:00:00.000Z'),
    });
    const [payload, signature] = state.split('.');
    const decoded = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8')) as {
      workspaceId: string;
    };
    decoded.workspaceId = 'workspace-2';

    const tampered = () =>
      verifyClickUpInstallState(
        `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`,
      );
    const expired = () => verifyClickUpInstallState(state, new Date('2026-07-07T12:31:00.000Z'));

    expect(tampered).toThrow(ClickUpInstallStateError);
    expect(expired).toThrow(ClickUpInstallStateError);
  });
});
