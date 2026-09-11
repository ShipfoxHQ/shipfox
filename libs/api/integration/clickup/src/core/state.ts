import {createHmac, randomUUID, timingSafeEqual} from 'node:crypto';
import {config} from '#config.js';
import {ClickUpInstallStateError} from './errors.js';

const STATE_TTL_SECONDS = 30 * 60;

interface ClickUpInstallStatePayload {
  workspaceId: string;
  userId: string;
  nonce: string;
  expiresAt: number;
}

export interface ClickUpInstallStateClaims {
  workspaceId: string;
  userId: string;
}

export function signClickUpInstallState(params: {
  workspaceId: string;
  userId: string;
  nonce?: string | undefined;
  now?: Date | undefined;
}): string {
  const now = params.now ?? new Date();
  const payload: ClickUpInstallStatePayload = {
    workspaceId: params.workspaceId,
    userId: params.userId,
    nonce: params.nonce ?? randomUUID(),
    expiresAt: Math.floor(now.getTime() / 1000) + STATE_TTL_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyClickUpInstallState(
  state: string,
  now: Date = new Date(),
): ClickUpInstallStateClaims {
  const [encodedPayload, signature, extra] = state.split('.');
  if (!encodedPayload || !signature || extra !== undefined) throw new ClickUpInstallStateError();
  if (!constantTimeEqual(signature, sign(encodedPayload))) {
    throw new ClickUpInstallStateError('Invalid ClickUp install state signature');
  }
  const payload = parsePayload(encodedPayload);
  if (payload.expiresAt < Math.floor(now.getTime() / 1000)) {
    throw new ClickUpInstallStateError('Expired ClickUp install state');
  }
  return {workspaceId: payload.workspaceId, userId: payload.userId};
}

function sign(encodedPayload: string): string {
  return createHmac('sha256', config.CLICKUP_OAUTH_CLIENT_SECRET)
    .update(encodedPayload)
    .digest('base64url');
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function parsePayload(encodedPayload: string): ClickUpInstallStatePayload {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid payload shape');
    const payload = parsed as Partial<ClickUpInstallStatePayload>;
    if (
      typeof payload.workspaceId !== 'string' ||
      typeof payload.userId !== 'string' ||
      typeof payload.nonce !== 'string' ||
      typeof payload.expiresAt !== 'number'
    ) {
      throw new Error('Invalid payload shape');
    }
    return payload as ClickUpInstallStatePayload;
  } catch {
    throw new ClickUpInstallStateError('Invalid ClickUp install state payload');
  }
}
