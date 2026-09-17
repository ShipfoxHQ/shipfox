import {GithubInstallStateError} from './errors.js';
import {signGithubInstallState, verifyGithubInstallState} from './state.js';

describe('GitHub install state', () => {
  it('verifies a signed state payload', () => {
    const workspaceId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const state = signGithubInstallState({
      workspaceId,
      userId,
      nonce: 'nonce',
      now: new Date('2026-04-30T00:00:00.000Z'),
    });

    const result = verifyGithubInstallState(state, new Date('2026-04-30T00:01:00.000Z'));

    expect(result).toEqual({workspaceId, userId});
  });

  it('keeps the legacy install-state wire format', () => {
    const workspaceId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const state = signGithubInstallState({
      workspaceId,
      userId,
      nonce: 'legacy-nonce',
      now: new Date('2026-04-30T00:00:00.000Z'),
    });

    const [encodedPayload] = state.split('.');
    const payload = JSON.parse(Buffer.from(encodedPayload ?? '', 'base64url').toString('utf8'));

    expect(payload).toEqual({
      workspaceId,
      userId,
      nonce: 'legacy-nonce',
      expiresAt: 1_777_509_000,
    });
  });

  it('rejects expired state payloads', () => {
    const state = signGithubInstallState({
      workspaceId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      nonce: 'nonce',
      now: new Date('2026-04-30T00:00:00.000Z'),
    });

    const result = () => verifyGithubInstallState(state, new Date('2026-04-30T00:31:00.000Z'));

    expect(result).toThrow(GithubInstallStateError);
  });

  it('rejects tampered state payloads', () => {
    const state = signGithubInstallState({
      workspaceId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      nonce: 'nonce',
    });

    const result = () => verifyGithubInstallState(`${state}tampered`);

    expect(result).toThrow(GithubInstallStateError);
  });
});
