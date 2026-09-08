import {loginResponseSchema} from '@shipfox/api-auth-dto';
import {listUserWorkspacesResponseSchema} from '@shipfox/api-workspaces-dto';
import {type ApiRequestAuthentication, checkedApiRequest} from '@shipfox/client-api';
import {type FetchQueryOptions, queryOptions} from '@tanstack/react-query';
import type {AuthenticatedSession, WorkspaceSummary} from '#core/session.js';
import {toAuthenticatedSession} from './session-mapper.js';

export interface UserWorkspaces {
  memberships: WorkspaceSummary[];
}

export const authRefreshQueryKey = ['auth', 'refresh'] as const;
export const userWorkspacesQueryKey = ['workspaces', 'mine'] as const;

type AuthRefreshQueryOptions = FetchQueryOptions<
  AuthenticatedSession,
  Error,
  AuthenticatedSession,
  typeof authRefreshQueryKey
>;

type UserWorkspacesQueryOptions = FetchQueryOptions<
  UserWorkspaces,
  Error,
  UserWorkspaces,
  typeof userWorkspacesQueryKey
>;

export async function listUserWorkspaces(
  token?: string,
  signal?: AbortSignal,
): Promise<UserWorkspaces> {
  const response = await checkedApiRequest(
    listUserWorkspacesResponseSchema,
    '/workspaces',
    token ? {headers: {authorization: `Bearer ${token}`}, signal} : {signal},
  );
  return {
    memberships: response.memberships.map((membership) => ({
      id: membership.workspace_id,
      name: membership.workspace_name,
      slug: membership.workspace_slug,
      membershipId: membership.id,
      status: membership.workspace_status,
    })),
  };
}

export function authRefreshQueryOptions(): AuthRefreshQueryOptions {
  return queryOptions({
    queryKey: authRefreshQueryKey,
    queryFn: ({signal}) => refreshAuthenticatedSession(signal),
    retry: false,
    staleTime: 0,
  });
}

export function userWorkspacesQueryOptions(token?: string): UserWorkspacesQueryOptions {
  return queryOptions({
    queryKey: userWorkspacesQueryKey,
    queryFn: ({signal}) => listUserWorkspaces(token, signal),
    retry: false,
    staleTime: 0,
  });
}

export async function refreshAuthenticatedSession(
  signal?: AbortSignal,
  authentication?: ApiRequestAuthentication,
): Promise<AuthenticatedSession> {
  const response = await checkedApiRequest(loginResponseSchema, '/auth/refresh', {
    method: 'POST',
    signal,
    ...(authentication ? {authentication} : {}),
  });
  return toAuthenticatedSession(response);
}

/**
 * Reads the ordinary cookie session without entering it into the refresh query
 * or the shell's ambient authentication state.
 */
export function snapshotAuthenticatedSession(signal?: AbortSignal): Promise<AuthenticatedSession> {
  return refreshAuthenticatedSession(signal, 'cookie-only');
}
