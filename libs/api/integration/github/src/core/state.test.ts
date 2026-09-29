import {createHash, createHmac} from 'node:crypto';
import {config} from '#config.js';
import {GithubInstallStateError, GithubLinkSelectionError, GithubLinkStateError} from './errors.js';
import {
  createGithubLinkState,
  signGithubInstallState,
  signGithubLinkSelection,
  verifyGithubInstallState,
  verifyGithubLinkSelection,
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

describe('GitHub link selection', () => {
  const issuedAt = new Date('2026-09-29T12:00:00.000Z');

  function selection() {
    const claims = {
      workspaceId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      installationIds: [123, 456],
    };
    return {claims, token: signGithubLinkSelection({...claims, now: issuedAt})};
  }

  function decodePayload(token: string): Record<string, unknown> {
    const [payload] = token.split('.');
    return JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8'));
  }

  // Re-signs with the real secret and domain so only the payload checks can reject it.
  function resign(payload: Record<string, unknown>): string {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', config.GITHUB_INSTALL_STATE_SECRET)
      .update(`shipfox/github/link-selection/v1.${encoded}`)
      .digest('base64url');
    return `${encoded}.${signature}`;
  }

  it('binds the actor, workspace, allowed ids, purpose, version and app', () => {
    const {claims, token} = selection();

    expect(verifyGithubLinkSelection(token, issuedAt)).toEqual(claims);
    expect(decodePayload(token)).toEqual({
      version: 1,
      purpose: 'link-selection',
      appId: config.GITHUB_APP_ID,
      proofId: expect.any(String),
      ...claims,
      issuedAt: 1_790_683_200,
      expiresAt: 1_790_683_500,
    });
  });

  it('expires five minutes after issuance', () => {
    const {token} = selection();

    expect(() =>
      verifyGithubLinkSelection(token, new Date('2026-09-29T12:05:00.000Z')),
    ).not.toThrow();
    expect(() => verifyGithubLinkSelection(token, new Date('2026-09-29T12:05:01.000Z'))).toThrow(
      'Expired GitHub link selection',
    );
  });

  it('rejects tampered payloads and signatures', () => {
    const {token} = selection();
    const [, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({...decodePayload(token), userId: crypto.randomUUID()}),
    ).toString('base64url');

    expect(() => verifyGithubLinkSelection(`${forged}.${signature}`, issuedAt)).toThrow(
      GithubLinkSelectionError,
    );
    expect(() => verifyGithubLinkSelection(`${token}x`, issuedAt)).toThrow(
      GithubLinkSelectionError,
    );
  });

  it.each([
    ['purpose', {purpose: 'link'}],
    ['version', {version: 2}],
    ['app', {appId: 'another-app'}],
    ['lifetime', {expiresAt: 1_790_683_200 + 60 * 60}],
    ['installation ids', {installationIds: []}],
  ])('rejects a validly signed payload with the wrong %s', (_label, override) => {
    const {token} = selection();

    expect(() =>
      verifyGithubLinkSelection(resign({...decodePayload(token), ...override}), issuedAt),
    ).toThrow('Invalid GitHub link selection payload');
  });

  it('is never accepted as install or link state, and neither is accepted as a selection', () => {
    const {claims, token} = selection();

    expect(() => verifyGithubInstallState(token, issuedAt)).toThrow(GithubInstallStateError);
    expect(() => verifyGithubLinkState(token, issuedAt)).toThrow(GithubLinkStateError);
    expect(() =>
      verifyGithubLinkSelection(signGithubInstallState({...claims, now: issuedAt}), issuedAt),
    ).toThrow(GithubLinkSelectionError);
    expect(() =>
      verifyGithubLinkSelection(createGithubLinkState({...claims, now: issuedAt}).state, issuedAt),
    ).toThrow(GithubLinkSelectionError);
  });
});
