import {createHash} from 'node:crypto';
import {GithubInstallStateError, GithubLinkStateError} from './errors.js';
import {
  createGithubLinkState,
  signGithubInstallState,
  verifyGithubInstallState,
  verifyGithubLinkState,
} from './state.js';

const LINK_STATE_ENVELOPE_PATTERN = /^v1:[A-Za-z0-9+/]+={0,2}$/u;

function decodeLinkStateEnvelope(state: string): Buffer {
  if (!state.startsWith('v1:')) throw new Error('Expected a v1 link state envelope');
  return Buffer.from(state.slice(3), 'base64');
}

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

    expect(link.state).toMatch(LINK_STATE_ENVELOPE_PATTERN);
    const envelope = decodeLinkStateEnvelope(link.state);
    expect(envelope.length).toBeGreaterThan(12 + 16);
    expect(envelope.subarray(0, 12)).toHaveLength(12);
    expect(envelope.subarray(12, 28)).toHaveLength(16);
    expect(envelope.toString('utf8')).not.toContain(link.codeVerifier);
    expect(() => JSON.parse(envelope.toString('utf8'))).toThrow();
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

    const firstEnvelope = decodeLinkStateEnvelope(first.state);
    const secondEnvelope = decodeLinkStateEnvelope(second.state);
    expect(firstEnvelope.subarray(0, 12)).not.toEqual(secondEnvelope.subarray(0, 12));
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
