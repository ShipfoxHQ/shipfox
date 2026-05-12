import type {
  E2eCreateInvitationBodyDto,
  E2eCreateInvitationResponseDto,
  E2eCreateWorkspaceBodyDto,
  E2eCreateWorkspaceResponseDto,
} from '@shipfox/api-workspaces-dto';
import {requestJson} from '@shipfox/e2e-core';

export type {
  E2eCreateInvitationBodyDto,
  E2eCreateInvitationResponseDto,
  E2eCreateWorkspaceBodyDto,
  E2eCreateWorkspaceResponseDto,
} from '@shipfox/api-workspaces-dto';

export interface CreateWorkspaceParams {
  userId: string;
  userEmail?: string;
  userName?: string | null;
  name?: string;
}

export interface CreateInvitationParams {
  workspaceId: string;
  email: string;
  invitedByUserId: string;
  invitedByDisplay?: string | null;
}

function generateName(): string {
  return `E2E Workspace ${crypto.randomUUID()}`;
}

export async function createWorkspace(
  params: CreateWorkspaceParams,
): Promise<E2eCreateWorkspaceResponseDto> {
  const body: E2eCreateWorkspaceBodyDto = {
    user_id: params.userId,
    user_email: params.userEmail,
    user_name: params.userName,
    name: params.name ?? generateName(),
  };
  return await requestJson<E2eCreateWorkspaceResponseDto>('post', '/__e2e/workspaces', {
    json: body,
  });
}

export async function createInvitation(
  params: CreateInvitationParams,
): Promise<E2eCreateInvitationResponseDto> {
  const body: E2eCreateInvitationBodyDto = {
    workspace_id: params.workspaceId,
    email: params.email,
    invited_by_user_id: params.invitedByUserId,
    invited_by_display: params.invitedByDisplay,
  };
  return await requestJson<E2eCreateInvitationResponseDto>(
    'post',
    '/__e2e/workspaces/invitations',
    {
      json: body,
    },
  );
}

export function createWorkspacesHelper() {
  return {
    create: createWorkspace,
    createInvitation,
  };
}

export type WorkspacesHelper = ReturnType<typeof createWorkspacesHelper>;

export interface WorkspacesFixtures {
  workspaces: WorkspacesHelper;
}

export const workspacesHelper = {
  workspaces: async (
    {request: _request}: {request: unknown},
    use: (helper: WorkspacesHelper) => Promise<void>,
  ) => {
    await use(createWorkspacesHelper());
  },
};
