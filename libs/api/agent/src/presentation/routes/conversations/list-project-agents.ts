import {listProjectAgentsResponseSchema} from '@shipfox/api-agent-dto';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {listProjectAgents} from '#core/project-agents.js';
import {toProjectAgentDtos} from '#presentation/dto/project-agent.js';
import {requireProjectAccess, translateConversationRouteError} from './access.js';

export function createListProjectAgentsRoute(params: {
  projects: ProjectsModuleClient;
  definitions: DefinitionsInterModuleClient | undefined;
}) {
  return defineRoute({
    method: 'GET',
    path: '/',
    description:
      'List the agents a new conversation can talk to: the built-in agent, then the custom agents from the project.',
    schema: {
      params: z.object({projectId: z.string().uuid()}),
      response: {
        200: listProjectAgentsResponseSchema,
      },
    },
    errorHandler: translateConversationRouteError,
    handler: async (request) => {
      const {projectId} = request.params;
      const {workspaceId} = await requireProjectAccess(request, projectId, params.projects);

      const agents = await listProjectAgents({
        definitions: params.definitions,
        workspaceId,
        projectId,
      });
      return {agents: toProjectAgentDtos(agents)};
    },
  });
}
