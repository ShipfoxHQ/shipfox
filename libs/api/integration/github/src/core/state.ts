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
import {GithubInstallStateError, GithubLinkSelectionError, GithubLinkStateError} from './errors.js';

const STATE_TTL_SECONDS = 30 * 60;
const LINK_STATE_VERSION = 1;
const LINK_STATE_PURPOSE = 'link';
const LINK_STATE_KEY_INFO = 'shipfox/github/install-state/link/v1';
const LINK_STATE_AAD_PREFIX = 'shipfox/github/install-state';
const PKCE_VERIFIER_BYTES = 32;
export const LINK_SELECTION_TTL_SECONDS = 5 * 60;
const LINK_SELECTION_VERSION = 1;
const LINK_SELECTION_PURPOSE = 'link-selection';
// Install state signs the bare base64url payload. This prefix contains `/`, which
// base64url never does, so a selection MAC can never verify as install state.
const LINK_SELECTION_SIGNING_DOMAIN = 'shipfox/github/link-selection/v1';

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

function sign(encodedPayload: string, domain?: string): string {
  return createHmac('sha256', config.GITHUB_INSTALL_STATE_SECRET)
    .update(domain ? `${domain}.${encodedPayload}` : encodedPayload)
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

export interface GithubLinkSelectionClaims {
  workspaceId: string;
  userId: string;
  installationIds: number[];
}

interface GithubLinkSelectionPayload {
  version: number;
  purpose: string;
  appId: string;
  proofId: string;
  workspaceId: string;
  userId: string;
  installationIds: number[];
  issuedAt: number;
  expiresAt: number;
}

/**
 * Signs the installation ids a GitHub user token listed at link completion. The
 * token restates that proof for five minutes: selection never rechecks the
 * user's GitHub access, so a revocation takes effect only once it expires.
 */
export function signGithubLinkSelection(params: {
  workspaceId: string;
  userId: string;
  installationIds: number[];
  now?: Date | undefined;
}): string {
  const issuedAt = Math.floor((params.now ?? new Date()).getTime() / 1000);
  const payload = {
    version: LINK_SELECTION_VERSION,
    purpose: LINK_SELECTION_PURPOSE,
    appId: config.GITHUB_APP_ID,
    proofId: randomUUID(),
    workspaceId: params.workspaceId,
    userId: params.userId,
    installationIds: params.installationIds,
    issuedAt,
    expiresAt: issuedAt + LINK_SELECTION_TTL_SECONDS,
  } satisfies GithubLinkSelectionPayload;
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encodedPayload}.${sign(encodedPayload, LINK_SELECTION_SIGNING_DOMAIN)}`;
}

export function verifyGithubLinkSelection(
  token: string,
  now: Date = new Date(),
): GithubLinkSelectionClaims {
  const [encodedPayload, signature, extra] = token.split('.');
  if (!encodedPayload || !signature || extra !== undefined) {
    throw new GithubLinkSelectionError('Invalid GitHub link selection');
  }
  if (!constantTimeEqual(signature, sign(encodedPayload, LINK_SELECTION_SIGNING_DOMAIN))) {
    throw new GithubLinkSelectionError('Invalid GitHub link selection signature');
  }

  const payload = parseLinkSelectionPayload(encodedPayload);
  if (payload.expiresAt < Math.floor(now.getTime() / 1000)) {
    throw new GithubLinkSelectionError('Expired GitHub link selection');
  }
  return {
    workspaceId: payload.workspaceId,
    userId: payload.userId,
    installationIds: payload.installationIds,
  };
}

function parseLinkSelectionPayload(encodedPayload: string): GithubLinkSelectionPayload {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) throw new Error('Invalid payload shape');
    const record = parsed as Record<string, unknown>;
    if (
      record.version !== LINK_SELECTION_VERSION ||
      record.purpose !== LINK_SELECTION_PURPOSE ||
      record.appId !== config.GITHUB_APP_ID ||
      typeof record.proofId !== 'string' ||
      typeof record.workspaceId !== 'string' ||
      typeof record.userId !== 'string' ||
      !isInstallationIdList(record.installationIds) ||
      !Number.isSafeInteger(record.issuedAt) ||
      !Number.isSafeInteger(record.expiresAt) ||
      (record.expiresAt as number) - (record.issuedAt as number) > LINK_SELECTION_TTL_SECONDS
    ) {
      throw new Error('Invalid payload shape');
    }
    return record as unknown as GithubLinkSelectionPayload;
  } catch {
    throw new GithubLinkSelectionError('Invalid GitHub link selection payload');
  }
}

function isInstallationIdList(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((id) => Number.isSafeInteger(id) && (id as number) > 0)
  );
}
