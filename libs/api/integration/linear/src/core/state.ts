import {createHmac, randomUUID, timingSafeEqual} from 'node:crypto';
import {config} from '#config.js';
import {LinearInstallStateError} from './errors.js';

const STATE_TTL_SECONDS = 30 * 60;

interface LinearInstallStatePayload {
  workspaceId: string;
  userId: string;
  nonce: string;
  expiresAt: number;
}

export interface LinearInstallStateClaims {
  workspaceId: string;
  userId: string;
}

export function signLinearInstallState(params: {
  workspaceId: string;
  userId: string;
  nonce?: string | undefined;
  now?: Date | undefined;
}): string {
  const now = params.now ?? new Date();
  const payload: LinearInstallStatePayload = {
    workspaceId: params.workspaceId,
    userId: params.userId,
    nonce: params.nonce ?? randomUUID(),
    expiresAt: Math.floor(now.getTime() / 1000) + STATE_TTL_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyLinearInstallState(
  state: string,
  now: Date = new Date(),
): LinearInstallStateClaims {
  const [encodedPayload, signature, extra] = state.split('.');
  if (!encodedPayload || !signature || extra !== undefined) {
    throw new LinearInstallStateError('Invalid Linear install state');
  }

  if (!constantTimeEqual(signature, sign(encodedPayload))) {
    throw new LinearInstallStateError('Invalid Linear install state signature');
  }

  const payload = parsePayload(encodedPayload);
  if (payload.expiresAt < Math.floor(now.getTime() / 1000)) {
    throw new LinearInstallStateError('Expired Linear install state');
  }

  return {workspaceId: payload.workspaceId, userId: payload.userId};
}

function sign(encodedPayload: string): string {
  return createHmac('sha256', config.LINEAR_OAUTH_CLIENT_SECRET)
    .update(encodedPayload)
    .digest('base64url');
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function parsePayload(encodedPayload: string): LinearInstallStatePayload {
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
    throw new LinearInstallStateError('Invalid Linear install state payload');
  }
}
