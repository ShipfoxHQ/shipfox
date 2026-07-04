import type {JobLeaseTokenClaims, RunnerSessionTokenClaims} from '@shipfox/api-auth-dto';
import type {WorkspaceRole} from '@shipfox/api-workspaces-dto';
import {ClientError} from '@shipfox/node-fastify';

export const AUTH_USER = 'user';
export const AUTH_RUNNER_REGISTRATION_TOKEN = 'runner-registration-token';
export const AUTH_RUNNER_SESSION = 'runner-session';
export const AUTH_LEASED_JOB = 'leased-job';
export const AUTH_PROVISIONER_TOKEN = 'provisioner-token';

export type WorkspaceStatus = 'active' | 'suspended' | 'deleted';

export interface UserContextMembership {
  workspaceId: string;
  role: WorkspaceRole;
}

export interface UserContext {
  userId: string;
  email: string;
  name: string | null;
  memberships: ReadonlyArray<UserContextMembership>;
  canAccess(workspaceId: string): boolean;
  hasRole(workspaceId: string, role: WorkspaceRole): boolean;
}

export interface BuildUserContextParams {
  userId: string;
  email: string;
  name?: string | null | undefined;
  memberships?: ReadonlyArray<UserContextMembership> | undefined;
}

export function buildUserContext(params: BuildUserContextParams): UserContext {
  const memberships = params.memberships ?? [];
  return {
    userId: params.userId,
    email: params.email,
    name: params.name ?? null,
    memberships,
    canAccess: (workspaceId) => memberships.some((m) => m.workspaceId === workspaceId),
    hasRole: (workspaceId, role) =>
      memberships.some((m) => m.workspaceId === workspaceId && m.role === role),
  };
}

export interface ProvisionerContext {
  provisionerTokenId: string;
  workspaceId: string;
}

export type LeasedJobContext = JobLeaseTokenClaims;
export type RunnerSessionContext = RunnerSessionTokenClaims;

type RequestWithContext = object;

const USER_CONTEXT_KEY = Symbol.for('@shipfox/api-auth-context/user');
const LEASED_JOB_CONTEXT_KEY = Symbol.for('@shipfox/api-auth-context/leased-job');
const PROVISIONER_CONTEXT_KEY = Symbol.for('@shipfox/api-auth-context/provisioner');
const RUNNER_SESSION_CONTEXT_KEY = Symbol.for('@shipfox/api-auth-context/runner-session');

export function setUserContext(request: RequestWithContext, context: UserContext): void {
  (request as Record<symbol, unknown>)[USER_CONTEXT_KEY] = context;
}

export function getUserContext(request: RequestWithContext): UserContext | null {
  return (
    ((request as Record<symbol, unknown>)[USER_CONTEXT_KEY] as UserContext | undefined) ?? null
  );
}

export function requireUserContext(request: RequestWithContext): UserContext {
  const context = getUserContext(request);
  if (!context) {
    throw new Error('User context is not available on this request');
  }
  return context;
}

export interface RequireWorkspaceAccessParams {
  request: RequestWithContext;
  workspaceId: string;
}

export interface RequireWorkspaceAccessResult {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}

/**
 * Authorizes the request's user for a workspace using only the verified session
 * token. Membership and role come from the token claims, so the check stays
 * stateless and does not read the database on the request path.
 */
export function requireWorkspaceAccess(
  params: RequireWorkspaceAccessParams,
): RequireWorkspaceAccessResult {
  const context = getUserContext(params.request);
  if (!context) {
    throw new ClientError('Authentication required', 'unauthorized', {status: 401});
  }

  const membership = context.memberships.find((m) => m.workspaceId === params.workspaceId);
  if (!membership) {
    throw new ClientError('Not a member of this workspace', 'forbidden', {status: 403});
  }

  return {workspaceId: params.workspaceId, userId: context.userId, role: membership.role};
}

export function setProvisionerContext(
  request: RequestWithContext,
  context: ProvisionerContext,
): void {
  (request as Record<symbol, unknown>)[PROVISIONER_CONTEXT_KEY] = context;
}

export function getProvisionerContext(request: RequestWithContext): ProvisionerContext | null {
  return (
    ((request as Record<symbol, unknown>)[PROVISIONER_CONTEXT_KEY] as
      | ProvisionerContext
      | undefined) ?? null
  );
}

export function requireProvisionerContext(request: RequestWithContext): ProvisionerContext {
  const context = getProvisionerContext(request);
  if (!context) {
    throw new Error('Provisioner context is not available on this request');
  }
  return context;
}

export function setLeasedJobContext(request: RequestWithContext, context: LeasedJobContext): void {
  (request as Record<symbol, unknown>)[LEASED_JOB_CONTEXT_KEY] = context;
}

export function getLeasedJobContext(request: RequestWithContext): LeasedJobContext | null {
  return (
    ((request as Record<symbol, unknown>)[LEASED_JOB_CONTEXT_KEY] as
      | LeasedJobContext
      | undefined) ?? null
  );
}

export function requireLeasedJobContext(request: RequestWithContext): LeasedJobContext {
  const context = getLeasedJobContext(request);
  if (!context) {
    throw new Error('Leased job context is not available on this request');
  }
  return context;
}

export function setRunnerSessionContext(
  request: RequestWithContext,
  context: RunnerSessionContext,
): void {
  (request as Record<symbol, unknown>)[RUNNER_SESSION_CONTEXT_KEY] = context;
}

export function getRunnerSessionContext(request: RequestWithContext): RunnerSessionContext | null {
  return (
    ((request as Record<symbol, unknown>)[RUNNER_SESSION_CONTEXT_KEY] as
      | RunnerSessionContext
      | undefined) ?? null
  );
}

export function requireRunnerSessionContext(request: RequestWithContext): RunnerSessionContext {
  const context = getRunnerSessionContext(request);
  if (!context) {
    throw new Error('Runner session context is not available on this request');
  }
  return context;
}
