import type {
  E2eCreateWorkflowRunPageFixtureBodyDto,
  E2eWorkflowRunPageFixtureResponseDto,
} from '@shipfox/api-workflows-dto';
import {requestJson} from '@shipfox/e2e-core';

export type {
  E2eCreateWorkflowRunPageFixtureBodyDto,
  E2eWorkflowRunPageFixtureResponseDto,
} from '@shipfox/api-workflows-dto';

export interface CreateWorkflowRunPageFixtureParams {
  workspaceId: string;
  projectName?: string | undefined;
}

export async function createWorkflowRunPageFixture(
  params: CreateWorkflowRunPageFixtureParams,
): Promise<E2eWorkflowRunPageFixtureResponseDto> {
  const body: E2eCreateWorkflowRunPageFixtureBodyDto = {
    workspace_id: params.workspaceId,
    project_name: params.projectName,
  };

  return await requestJson<E2eWorkflowRunPageFixtureResponseDto>(
    'post',
    '/__e2e/workflows/run-page-fixture',
    {json: body},
  );
}

export function createWorkflowsHelper() {
  return {
    createRunPageFixture: createWorkflowRunPageFixture,
  };
}

export type WorkflowsHelper = ReturnType<typeof createWorkflowsHelper>;

export interface WorkflowsFixtures {
  workflows: WorkflowsHelper;
}

export const workflowsHelper = {
  workflows: async (
    {request: _request}: {request: unknown},
    use: (helper: WorkflowsHelper) => Promise<void>,
  ) => {
    await use(createWorkflowsHelper());
  },
};
