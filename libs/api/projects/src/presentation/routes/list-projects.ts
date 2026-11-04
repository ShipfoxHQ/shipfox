import {AUTH_USER, requireUserContext, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {listProjectsQuerySchema, listProjectsResponseSchema} from '@shipfox/api-projects-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {tryEnsureDefaultProject} from '#core/index.js';
import {listProjects} from '#db/index.js';
import {toProjectDto} from '#presentation/dto/index.js';
import {decodeProjectCursor, encodeProjectCursor} from './cursor.js';

export function createListProjectsRoute(integrations: IntegrationsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/',
    auth: AUTH_USER,
    description: 'List projects in a workspace.',
    schema: {
      querystring: listProjectsQuerySchema,
      response: {
        200: listProjectsResponseSchema,
      },
    },
    handler: async (request) => {
      const {workspace_id: workspaceId, limit, cursor, search} = request.query;
      const decodedCursor = decodeProjectCursor(cursor);
      if (cursor && !decodedCursor) {
        throw new ClientError('Invalid cursor', 'invalid-cursor', {status: 400});
      }

      requireWorkspaceAccess({request, workspaceId});
      // The first page of the whole list is what the hub and the project switcher read. A workspace
      // made before default projects gets its own here, the first time anyone opens the app.
      if (!cursor && !search) {
        await tryEnsureDefaultProject({
          actorId: requireUserContext(request).userId,
          workspaceId,
          integrations,
        });
      }
      const result = await listProjects({workspaceId, limit, cursor: decodedCursor, search});

      return {
        projects: result.projects.map(toProjectDto),
        next_cursor: result.nextCursor ? encodeProjectCursor(result.nextCursor) : null,
      };
    },
  });
}
