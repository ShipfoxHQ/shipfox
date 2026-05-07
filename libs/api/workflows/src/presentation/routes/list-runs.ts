import {ProjectNotFoundError, requireProjectAccess} from '@shipfox/api-projects';
import {runListResponseSchema} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {listWorkflowRunsByProject} from '#db/index.js';
import {toRunDto} from '#presentation/dto/index.js';

export const listRunsRoute = defineRoute({
  method: 'GET',
  path: '/',
  description: 'List workflow runs for a project',
  schema: {
    querystring: z.object({
      project_id: z.string().uuid(),
    }),
    response: {
      200: runListResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof ProjectNotFoundError) {
      throw new ClientError(error.message, 'project-not-found', {status: 404});
    }
    throw error;
  },
  handler: async (request) => {
    const {project_id: projectId} = request.query;

    const {project} = await requireProjectAccess({request, projectId});

    const runs = await listWorkflowRunsByProject(project.id);

    return {
      runs: runs.map(toRunDto),
    };
  },
});
