import {
  listWorkspaceWorkflowTemplatesResponseSchema,
  type WorkspaceWorkflowTemplateDto,
} from '@shipfox/api-agent-access-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {queryOptions, useQuery} from '@tanstack/react-query';
import type {WorkflowTemplate} from '#core/workflow-templates.js';

const WORKFLOW_TEMPLATES_STALE_TIME_MS = 60_000;

export const workflowTemplateQueryKeys = {
  all: ['onboarding', 'workflow-templates'] as const,
  workspace: (workspaceId: string) => [...workflowTemplateQueryKeys.all, workspaceId] as const,
};

function toWorkflowTemplate(dto: WorkspaceWorkflowTemplateDto): WorkflowTemplate {
  return {
    id: dto.id,
    title: dto.title,
    summary: dto.summary,
    group: dto.group,
    startLabel: dto.start_label,
    providers: dto.providers,
    missingProviders: dto.missing_providers,
    prompt: dto.prompt,
  };
}

export async function listWorkspaceWorkflowTemplates({
  workspaceId,
  signal,
}: {
  workspaceId: string;
  signal?: AbortSignal;
}): Promise<WorkflowTemplate[]> {
  const response = await checkedApiRequest(
    listWorkspaceWorkflowTemplatesResponseSchema,
    `/workspaces/${encodeURIComponent(workspaceId)}/workflow-templates`,
    {signal},
  );
  return response.templates.map(toWorkflowTemplate);
}

/**
 * Ranked for the workspace's connections, so it refetches on focus: the user
 * connects a tool in another tab and comes back expecting the template to move.
 */
export function workspaceWorkflowTemplatesQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: workflowTemplateQueryKeys.workspace(workspaceId),
    queryFn: ({signal}) => listWorkspaceWorkflowTemplates({workspaceId, signal}),
    staleTime: WORKFLOW_TEMPLATES_STALE_TIME_MS,
  });
}

export function useWorkspaceWorkflowTemplatesQuery(workspaceId: string) {
  return useQuery(workspaceWorkflowTemplatesQueryOptions(workspaceId));
}
