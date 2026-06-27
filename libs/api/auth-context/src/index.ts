import type {JobLeaseTokenClaims} from '@shipfox/api-auth-dto';
import type {WorkspaceRole} from '@shipfox/api-workspaces-dto';

export const AUTH_USER = 'user';
export const AUTH_RUNNER_TOKEN = 'runner-token';
export const AUTH_LEASED_JOB = 'leased-job';

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

export type LeasedJobContext = JobLeaseTokenClaims;

type RequestWithContext = object;

const USER_CONTEXT_KEY = Symbol.for('@shipfox/api-auth-context/user');
const LEASED_JOB_CONTEXT_KEY = Symbol.for('@shipfox/api-auth-context/leased-job');

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
