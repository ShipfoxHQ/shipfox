export interface WorkflowRunPermalinkWorkspace {
  id: string;
  slug: string;
}

export interface WorkflowRunPermalinkProject {
  workspaceId: string;
  slug: string;
}

export type WorkflowRunPermalinkResolution =
  | {
      kind: 'resolved';
      workspaceSlug: string;
      projectSlug: string;
    }
  | {kind: 'not-found'}
  | {kind: 'no-access'};

export async function resolveWorkflowRunPermalink({
  workflowRunId,
  workspaces,
  readRunOverview,
  readProject,
}: {
  workflowRunId: string;
  workspaces: readonly WorkflowRunPermalinkWorkspace[];
  readRunOverview: (workflowRunId: string) => Promise<{projectId: string} | null>;
  readProject: (projectId: string) => Promise<WorkflowRunPermalinkProject | null>;
}): Promise<WorkflowRunPermalinkResolution> {
  const overview = await readRunOverview(workflowRunId);
  if (!overview) return {kind: 'not-found'};

  const project = await readProject(overview.projectId);
  if (!project) return {kind: 'not-found'};

  const workspace = workspaces.find(({id}) => id === project.workspaceId);
  if (!workspace) return {kind: 'no-access'};

  return {
    kind: 'resolved',
    workspaceSlug: workspace.slug,
    projectSlug: project.slug,
  };
}
