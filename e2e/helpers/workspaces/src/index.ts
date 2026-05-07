import type {
  E2eCreateWorkspaceBodyDto,
  E2eCreateWorkspaceResponseDto,
} from '@shipfox/api-workspaces-dto';
import {requestJson} from '@shipfox/e2e-core';

export type {
  E2eCreateWorkspaceBodyDto,
  E2eCreateWorkspaceResponseDto,
} from '@shipfox/api-workspaces-dto';

export interface CreateWorkspaceParams {
  userId: string;
  name?: string;
}

function generateName(): string {
  return `E2E Workspace ${crypto.randomUUID()}`;
}

export async function createWorkspace(
  params: CreateWorkspaceParams,
): Promise<E2eCreateWorkspaceResponseDto> {
  const body: E2eCreateWorkspaceBodyDto = {
    user_id: params.userId,
    name: params.name ?? generateName(),
  };
  return await requestJson<E2eCreateWorkspaceResponseDto>('post', '/__e2e/workspaces', {
    json: body,
  });
}

export function createWorkspacesHelper() {
  return {
    create: createWorkspace,
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
