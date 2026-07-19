import {createHmac, randomUUID, timingSafeEqual} from 'node:crypto';
import {config} from '#config.js';
import {JiraInstallStateError} from './errors.js';

const STATE_TTL_SECONDS = 30 * 60;

interface JiraInstallStatePayload {
  workspaceId: string;
  userId: string;
  nonce: string;
  expiresAt: number;
}

export interface JiraInstallStateClaims {
  workspaceId: string;
  userId: string;
}

export function signJiraInstallState(params: {
  workspaceId: string;
  userId: string;
  nonce?: string | undefined;
  now?: Date | undefined;
}): string {
  const now = params.now ?? new Date();
  const payload: JiraInstallStatePayload = {
    workspaceId: params.workspaceId,
    userId: params.userId,
    nonce: params.nonce ?? randomUUID(),
    expiresAt: Math.floor(now.getTime() / 1000) + STATE_TTL_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyJiraInstallState(
  state: string,
  now: Date = new Date(),
): JiraInstallStateClaims {
  const [encodedPayload, signature, extra] = state.split('.');
  if (!encodedPayload || !signature || extra !== undefined) throw new JiraInstallStateError();
  if (!constantTimeEqual(signature, sign(encodedPayload))) {
    throw new JiraInstallStateError('Invalid Jira install state signature');
  }
  const payload = parsePayload(encodedPayload);
  if (payload.expiresAt < Math.floor(now.getTime() / 1000)) {
    throw new JiraInstallStateError('Expired Jira install state');
  }
  return {workspaceId: payload.workspaceId, userId: payload.userId};
}

function sign(encodedPayload: string): string {
  return createHmac('sha256', config.JIRA_OAUTH_CLIENT_SECRET)
    .update(encodedPayload)
    .digest('base64url');
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function parsePayload(encodedPayload: string): JiraInstallStatePayload {
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
  } catch {
    throw new JiraInstallStateError('Invalid Jira install state payload');
  }
}
