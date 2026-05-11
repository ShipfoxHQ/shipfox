import type {
  CreateWorkspaceBodyDto,
  ListUserWorkspacesResponseDto,
  WorkspaceResponseDto,
} from '@shipfox/api-workspaces-dto';
import {apiRequest} from '@shipfox/client-api';
import {useMutation} from '@tanstack/react-query';
import {useRefreshAuth} from './refresh-auth.js';

export async function createWorkspace(body: CreateWorkspaceBodyDto) {
  return await apiRequest<WorkspaceResponseDto>('/workspaces', {method: 'POST', body});
}

export const userWorkspacesQueryKey = ['workspaces', 'mine'] as const;

export async function listUserWorkspaces(token?: string) {
  return await apiRequest<ListUserWorkspacesResponseDto>(
    '/workspaces',
    token ? {headers: {authorization: `Bearer ${token}`}} : {},
  );
}

export function useCreateWorkspaceAuth() {
  const refreshAuth = useRefreshAuth();

  return useMutation({
    mutationFn: createWorkspace,
    onSuccess: async () => {
      // The new workspace introduces a membership the existing access token
      // doesn't carry. Refresh so the next request includes it in the JWT
      // claim and passes the in-memory canAccess() check on the server.
      await refreshAuth();
    },
  });
}
