import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {runReadinessQuerySchema, runReadinessResponseSchema} from '@shipfox/api-triggers-dto';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {defineRoute} from '@shipfox/node-fastify';
import {toRunIssueDto} from '#presentation/dto/run-readiness.js';
import {requireProjectAccess} from './project-access.js';

export function createCheckRunReadinessRoute(
  workflows: WorkflowsModuleClient,
  projects: ProjectsModuleClient,
) {
  return defineRoute({
    method: 'GET',
    path: '/readiness',
    description:
      'Report what each workflow definition still needs before its runs can start cleanly. Advisory: run creation stays the authority.',
    schema: {
      querystring: runReadinessQuerySchema,
      response: {
        200: runReadinessResponseSchema,
      },
    },
    handler: async (request) => {
      const {project_id: projectId, definition_id: definitionIds} = request.query;
      const {workspaceId} = await requireProjectAccess(request, projectId, projects);

      const {definitions} = await workflows.checkRunReadiness({
        workspaceId,
        projectId,
        definitionIds,
      });

      return {
        definitions: definitions.map(({definitionId, issues}) => ({
          definition_id: definitionId,
          issues: issues.map(toRunIssueDto),
        })),
      };
    },
  });
}
