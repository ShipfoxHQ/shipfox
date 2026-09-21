import {NotionInstallStateError} from './errors.js';
import {signNotionInstallState, verifyNotionInstallState} from './state.js';

describe('Notion install state', () => {
  it('round-trips signed workspace and user claims', () => {
    const state = signNotionInstallState({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      nonce: 'nonce-1',
      now: new Date('2026-07-07T12:00:00.000Z'),
    });

    const result = verifyNotionInstallState(state, {
      nonce: 'nonce-1',
      now: new Date('2026-07-07T12:05:00.000Z'),
    });

    expect(result).toEqual({workspaceId: 'workspace-1', userId: 'user-1'});
  });

  it('rejects tampered and expired states', () => {
    const state = signNotionInstallState({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      nonce: 'nonce-1',
      now: new Date('2026-07-07T12:00:00.000Z'),
    });
    const [encodedPayload, signature] = state.split('.');
    const payload = JSON.parse(Buffer.from(encodedPayload ?? '', 'base64url').toString('utf8'));
    payload.workspaceId = 'workspace-2';

    expect(() =>
      verifyNotionInstallState(
        `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`,
        {nonce: 'nonce-1', now: new Date('2026-07-07T12:05:00.000Z')},
      ),
    ).toThrow(NotionInstallStateError);
    expect(() =>
      verifyNotionInstallState(state, {
        nonce: 'nonce-1',
        now: new Date('2026-07-07T12:31:00.000Z'),
      }),
    ).toThrow(NotionInstallStateError);
  });

  it('rejects state from another browser session', () => {
    const state = signNotionInstallState({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      nonce: 'nonce-1',
    });

    const result = () => verifyNotionInstallState(state, {nonce: 'nonce-2'});

    expect(result).toThrow(NotionInstallStateError);
  });
});
