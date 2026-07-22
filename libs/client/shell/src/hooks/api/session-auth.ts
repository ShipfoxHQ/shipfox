import {loginResponseSchema} from '@shipfox/api-auth-dto';
import {listUserWorkspacesResponseSchema} from '@shipfox/api-workspaces-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import type {AuthenticatedSession, WorkspaceSummary} from '#core/session.js';
import {toAuthenticatedSession} from './session-mapper.js';

export async function listUserWorkspaces(
  token?: string,
): Promise<{memberships: WorkspaceSummary[]}> {
  const response = await checkedApiRequest(
    listUserWorkspacesResponseSchema,
    '/workspaces',
    token ? {headers: {authorization: `Bearer ${token}`}} : {},
  );
  return {
    memberships: response.memberships.map((membership) => ({
      id: membership.workspace_id,
      name: membership.workspace_name,
      membershipId: membership.id,
    })),
  };
}

export async function refreshAuthenticatedSession(): Promise<AuthenticatedSession> {
  const response = await checkedApiRequest(loginResponseSchema, '/auth/refresh', {method: 'POST'});
  return toAuthenticatedSession(response);
}
