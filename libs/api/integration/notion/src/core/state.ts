import {createHmac, timingSafeEqual} from 'node:crypto';
import {config} from '#config.js';
import {NotionInstallStateError} from './errors.js';

export const NOTION_INSTALL_STATE_TTL_SECONDS = 30 * 60;

interface NotionInstallStatePayload {
  workspaceId: string;
  userId: string;
  nonce: string;
  expiresAt: number;
}

export interface NotionInstallStateClaims {
  workspaceId: string;
  userId: string;
}

export function signNotionInstallState(params: {
  workspaceId: string;
  userId: string;
  nonce: string;
  now?: Date | undefined;
}): string {
  const now = params.now ?? new Date();
  const payload: NotionInstallStatePayload = {
    workspaceId: params.workspaceId,
    userId: params.userId,
    nonce: params.nonce,
    expiresAt: Math.floor(now.getTime() / 1000) + NOTION_INSTALL_STATE_TTL_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyNotionInstallState(
  state: string,
  options: {nonce: string | undefined; now?: Date | undefined},
): NotionInstallStateClaims {
  const now = options.now ?? new Date();
  const [encodedPayload, signature, extra] = state.split('.');
  if (!encodedPayload || !signature || extra !== undefined) {
    throw new NotionInstallStateError();
  }
  if (!constantTimeEqual(signature, sign(encodedPayload))) {
    throw new NotionInstallStateError('Invalid Notion install state signature');
  }

  const payload = parsePayload(encodedPayload);
  if (!options.nonce || !constantTimeEqual(payload.nonce, options.nonce)) {
    throw new NotionInstallStateError('Notion install state is not bound to this browser session');
  }
  if (payload.expiresAt < Math.floor(now.getTime() / 1000)) {
    throw new NotionInstallStateError('Expired Notion install state');
  }
  return {workspaceId: payload.workspaceId, userId: payload.userId};
}

function sign(encodedPayload: string): string {
  return createHmac('sha256', config.NOTION_OAUTH_CLIENT_SECRET)
    .update(encodedPayload)
    .digest('base64url');
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function parsePayload(encodedPayload: string): NotionInstallStatePayload {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid payload shape');
    const payload = parsed as Partial<NotionInstallStatePayload>;
    if (
      typeof payload.workspaceId !== 'string' ||
      typeof payload.userId !== 'string' ||
      typeof payload.nonce !== 'string' ||
      typeof payload.expiresAt !== 'number'
    ) {
      throw new Error('Invalid payload shape');
    }
    return payload as NotionInstallStatePayload;
  } catch {
    throw new NotionInstallStateError('Invalid Notion install state payload');
  }
}
