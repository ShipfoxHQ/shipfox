import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  workflowLatestRunsQuerySchema,
  workflowLatestRunsResponseSchema,
} from '@shipfox/api-workflows-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import {listLatestSyncedWorkflowRuns} from '#db/index.js';
import {requireProjectAccess} from './project-access.js';

export function listLatestRunsRoute(projects: ProjectsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/latest',
    description: 'Get the latest synced run of each requested workflow definition',
    schema: {
      querystring: workflowLatestRunsQuerySchema,
      response: {
        200: workflowLatestRunsResponseSchema,
      },
    },
    handler: async (request) => {
      const startedAt = performance.now();
      const {project_id: projectId, definition_ids: definitionIds} = request.query;

      const project = await requireProjectAccess(request, projectId, projects);
      const runs = await listLatestSyncedWorkflowRuns({projectId: project.id, definitionIds});

      logger().info(
        {
          projectId: project.id,
          definitionCount: definitionIds.length,
          resultCount: runs.length,
          durationMs: Math.round(performance.now() - startedAt),
        },
        'Listed latest workflow runs',
      );

      return {
        runs: runs.map((run) => ({
          id: run.id,
          definition_id: run.definitionId,
          number: run.number,
          status: run.status,
          created_at: run.createdAt.toISOString(),
        })),
      };
    },
  });
}
