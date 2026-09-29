import {
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import {openEnvelopeText, sealEnvelopeText} from '@shipfox/node-envelope-encryption';
import {config} from '#config.js';
import {GithubInstallStateError, GithubLinkStateError} from './errors.js';

const STATE_TTL_SECONDS = 30 * 60;
const LINK_STATE_VERSION = 1;
const LINK_STATE_PURPOSE = 'link';
const LINK_STATE_KEY_INFO = 'shipfox/github/install-state/link/v1';
const LINK_STATE_AAD_PREFIX = 'shipfox/github/install-state';
const PKCE_VERIFIER_BYTES = 32;

interface GithubInstallStatePayload {
  workspaceId: string;
  userId: string;
  nonce: string;
  expiresAt: number;
}

export interface GithubInstallStateClaims {
  workspaceId: string;
  userId: string;
}

export interface GithubLinkStateClaims extends GithubInstallStateClaims {
  codeVerifier: string;
}

export interface GithubLinkState {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
}

export function signGithubInstallState(params: {
  workspaceId: string;
  userId: string;
  nonce?: string | undefined;
  now?: Date | undefined;
}): string {
  const now = params.now ?? new Date();
  const payload: GithubInstallStatePayload = {
    workspaceId: params.workspaceId,
    userId: params.userId,
    nonce: params.nonce ?? randomUUID(),
    expiresAt: Math.floor(now.getTime() / 1000) + STATE_TTL_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyGithubInstallState(
  state: string,
  now: Date = new Date(),
): GithubInstallStateClaims {
  const [encodedPayload, signature, extra] = state.split('.');
  if (!encodedPayload || !signature || extra !== undefined) {
    throw new GithubInstallStateError('Invalid GitHub install state');
  }

  if (!constantTimeEqual(signature, sign(encodedPayload))) {
    throw new GithubInstallStateError('Invalid GitHub install state signature');
  }

  const payload = parsePayload(encodedPayload);
  if (payload.expiresAt < Math.floor(now.getTime() / 1000)) {
    throw new GithubInstallStateError('Expired GitHub install state');
  }

  return {workspaceId: payload.workspaceId, userId: payload.userId};
}

function sign(encodedPayload: string): string {
  return createHmac('sha256', config.GITHUB_INSTALL_STATE_SECRET)
    .update(encodedPayload)
    .digest('base64url');
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function createGithubLinkState(params: {
  workspaceId: string;
  userId: string;
  nonce?: string | undefined;
  now?: Date | undefined;
}): GithubLinkState {
  const codeVerifier = randomBytes(PKCE_VERIFIER_BYTES).toString('base64url');
  const now = params.now ?? new Date();
  const payload = {
    version: LINK_STATE_VERSION,
    purpose: LINK_STATE_PURPOSE,
    workspaceId: params.workspaceId,
    userId: params.userId,
    nonce: params.nonce ?? randomUUID(),
    expiresAt: Math.floor(now.getTime() / 1000) + STATE_TTL_SECONDS,
    codeVerifier,
  } satisfies GithubLinkStatePayload;
  const plaintext = Buffer.from(JSON.stringify(payload));
  const state = sealEnvelopeText({
    key: deriveLinkStateKey(),
    plaintext,
    aad: linkStateAad(),
  });

  return {
    state,
    codeVerifier,
    codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url'),
  };
}

export function verifyGithubLinkState(
  state: string,
  now: Date = new Date(),
): GithubLinkStateClaims {
  try {
    const plaintext = openEnvelopeText({
      key: deriveLinkStateKey(),
      encoded: state,
      aad: linkStateAad(),
    });
    const payload = parseLinkPayload(plaintext.toString('utf8'));
    if (payload.expiresAt < Math.floor(now.getTime() / 1000)) {
      throw new GithubLinkStateError('Expired GitHub link state');
    }
    return {
      workspaceId: payload.workspaceId,
      userId: payload.userId,
      codeVerifier: payload.codeVerifier,
    };
  } catch (error) {
    if (error instanceof GithubLinkStateError) throw error;
    throw new GithubLinkStateError('Invalid GitHub link state');
  }
}

interface GithubLinkStatePayload {
  version: number;
  purpose: string;
  workspaceId: string;
  userId: string;
  nonce: string;
  expiresAt: number;
  codeVerifier: string;
}

function deriveLinkStateKey(): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(config.GITHUB_INSTALL_STATE_SECRET, 'utf8'),
      Buffer.alloc(0),
      LINK_STATE_KEY_INFO,
      32,
    ),
  );
}

function linkStateAad(): string {
  return JSON.stringify([
    LINK_STATE_AAD_PREFIX,
    LINK_STATE_VERSION,
    LINK_STATE_PURPOSE,
    config.GITHUB_APP_ID,
    config.GITHUB_APP_CLIENT_ID,
  ]);
}

function parseLinkPayload(raw: string): GithubLinkStatePayload {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Invalid payload shape');
    }
    const record = parsed as Record<string, unknown>;
    if (
      record.version !== LINK_STATE_VERSION ||
      record.purpose !== LINK_STATE_PURPOSE ||
      typeof record.workspaceId !== 'string' ||
      typeof record.userId !== 'string' ||
      typeof record.nonce !== 'string' ||
      typeof record.expiresAt !== 'number' ||
      !Number.isSafeInteger(record.expiresAt) ||
      typeof record.codeVerifier !== 'string' ||
      record.codeVerifier.length < 43
    ) {
      throw new Error('Invalid payload shape');
    }
    return record as unknown as GithubLinkStatePayload;
  } catch {
    throw new GithubLinkStateError('Invalid GitHub link state payload');
  }
}

function parsePayload(encodedPayload: string): GithubInstallStatePayload {
  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (
      typeof parsed.workspaceId !== 'string' ||
      typeof parsed.userId !== 'string' ||
      typeof parsed.nonce !== 'string' ||
      typeof parsed.expiresAt !== 'number'
    ) {
      throw new Error('Invalid payload shape');
    }
    return parsed;
  } catch (_error) {
    throw new GithubInstallStateError('Invalid GitHub install state payload');
  }
}
