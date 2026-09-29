import {createHash} from 'node:crypto';
import {GithubInstallStateError, GithubLinkStateError} from './errors.js';
import {
  createGithubLinkState,
  signGithubInstallState,
  verifyGithubInstallState,
  verifyGithubLinkState,
} from './state.js';

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

  it('encrypts the link verifier and verifies the PKCE state', () => {
    const workspaceId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const link = createGithubLinkState({workspaceId, userId, nonce: 'nonce'});

    expect(link.state).not.toContain(link.codeVerifier);
    expect(link.codeChallenge).toBe(
      createHash('sha256').update(link.codeVerifier).digest('base64url'),
    );
    expect(verifyGithubLinkState(link.state)).toEqual({
      workspaceId,
      userId,
      codeVerifier: link.codeVerifier,
    });
  });

  it('uses a fresh encrypted nonce and isolates link state from legacy state', () => {
    const params = {workspaceId: crypto.randomUUID(), userId: crypto.randomUUID()};
    const first = createGithubLinkState(params);
    const second = createGithubLinkState(params);

    expect(first.state).not.toBe(second.state);
    expect(() => verifyGithubLinkState(signGithubInstallState(params))).toThrow(
      GithubLinkStateError,
    );
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
