import {LinearInstallStateError} from './errors.js';
import {signLinearInstallState, verifyLinearInstallState} from './state.js';

describe('Linear install state', () => {
  it('round-trips signed workspace and user claims', () => {
    const state = signLinearInstallState({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      nonce: 'nonce-1',
      now: new Date('2026-07-07T12:00:00.000Z'),
    });

    const result = verifyLinearInstallState(state, new Date('2026-07-07T12:05:00.000Z'));

    expect(result).toEqual({workspaceId: 'workspace-1', userId: 'user-1'});
  });

  it('rejects tampered payloads', () => {
    const state = signLinearInstallState({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      nonce: 'nonce-1',
      now: new Date('2026-07-07T12:00:00.000Z'),
    });
    const [encodedPayload, signature] = state.split('.');
    const payload = JSON.parse(Buffer.from(encodedPayload ?? '', 'base64url').toString('utf8'));
    payload.workspaceId = 'workspace-2';
    const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');

    const result = () =>
      verifyLinearInstallState(
        `${tamperedPayload}.${signature}`,
        new Date('2026-07-07T12:05:00.000Z'),
      );

    expect(result).toThrow(LinearInstallStateError);
  });

  it('rejects expired states', () => {
    const state = signLinearInstallState({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      nonce: 'nonce-1',
      now: new Date('2026-07-07T12:00:00.000Z'),
    });

    const result = () => verifyLinearInstallState(state, new Date('2026-07-07T12:31:00.000Z'));

    expect(result).toThrow(LinearInstallStateError);
  });
});
