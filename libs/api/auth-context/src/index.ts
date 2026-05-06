import type {WorkspaceRole} from '@shipfox/api-workspaces-dto';

export const AUTH_USER = 'user';
export const AUTH_API_KEY = 'api-key';
export const AUTH_RUNNER_TOKEN = 'runner-token';

export type WorkspaceStatus = 'active' | 'suspended' | 'deleted';

export interface UserContextMembership {
  workspaceId: string;
  role: WorkspaceRole;
}

export interface UserContext {
  userId: string;
  email: string;
  memberships: ReadonlyArray<UserContextMembership>;
  canAccess(workspaceId: string): boolean;
  hasRole(workspaceId: string, role: WorkspaceRole): boolean;
}

export interface BuildUserContextParams {
  userId: string;
  email: string;
  memberships?: ReadonlyArray<UserContextMembership> | undefined;
}

export function buildUserContext(params: BuildUserContextParams): UserContext {
  const memberships = params.memberships ?? [];
  return {
    userId: params.userId,
    email: params.email,
    memberships,
    canAccess: (workspaceId) => memberships.some((m) => m.workspaceId === workspaceId),
    hasRole: (workspaceId, role) =>
      memberships.some((m) => m.workspaceId === workspaceId && m.role === role),
  };
}

export interface ApiKeyContext {
  apiKeyId: string;
  workspaceId: string;
  workspaceStatus: WorkspaceStatus;
  scopes: string[];
}

type RequestWithContext = object;

const USER_CONTEXT_KEY = Symbol.for('@shipfox/api-auth-context/user');
const API_KEY_CONTEXT_KEY = Symbol.for('@shipfox/api-auth-context/api-key');

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

export function setApiKeyContext(request: RequestWithContext, context: ApiKeyContext): void {
  (request as Record<symbol, unknown>)[API_KEY_CONTEXT_KEY] = context;
}

export function getApiKeyContext(request: RequestWithContext): ApiKeyContext | null {
  return (
    ((request as Record<symbol, unknown>)[API_KEY_CONTEXT_KEY] as ApiKeyContext | undefined) ?? null
  );
}

export function requireApiKeyContext(request: RequestWithContext): ApiKeyContext {
  const context = getApiKeyContext(request);
  if (!context) {
    throw new Error('API key context is not available on this request');
  }
  return context;
}
