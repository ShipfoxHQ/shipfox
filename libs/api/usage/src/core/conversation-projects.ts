import {
  type ProjectsModuleClient,
  projectsInterModuleContract,
} from '@shipfox/api-projects-dto/inter-module';
import type {InferenceSegmentInputDto} from '@shipfox/api-usage-dto';
import {isInterModuleKnownError} from '@shipfox/inter-module';

export type UsageProjectsClient = Pick<ProjectsModuleClient, 'requireProjectForWorkspace'>;

/**
 * A step segment proves its project against the projected job execution. A conversation has no
 * such record, so its project is confirmed with the owner before anything is metered against it.
 */
export async function assertConversationProjects(params: {
  projects: UsageProjectsClient;
  segments: readonly InferenceSegmentInputDto[];
}): Promise<void> {
  const owners = new Map(
    params.segments
      .filter((segment) => segment.conversationId)
      .map(({workspaceId, projectId}) => [`${workspaceId}:${projectId}`, {workspaceId, projectId}]),
  );

  for (const owner of owners.values()) {
    try {
      await params.projects.requireProjectForWorkspace(owner);
    } catch (error) {
      if (
        isInterModuleKnownError(
          projectsInterModuleContract.methods.requireProjectForWorkspace,
          error,
        )
      ) {
        throw new Error(`Inference segment identity mismatch for project ${owner.projectId}`, {
          cause: error,
        });
      }
      throw error;
    }
  }
}
