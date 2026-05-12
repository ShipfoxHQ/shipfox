import {ProjectNotFoundError, requireProjectAccess} from '@shipfox/api-projects';
import {runListQuerySchema, runListResponseSchema} from '@shipfox/api-workflows-dto';
import {decodeTimestampIdCursor, encodeTimestampIdCursor} from '@shipfox/node-drizzle';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import {listWorkflowRuns} from '#db/index.js';
import {toRunDto} from '#presentation/dto/index.js';

export const listRunsRoute = defineRoute({
  method: 'GET',
  path: '/',
  description: 'List workflow runs for a project',
  schema: {
    querystring: runListQuerySchema,
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
    const startedAt = performance.now();
    const {
      project_id: projectId,
      limit,
      cursor,
      status,
      definition_id: definitionId,
      trigger_source: triggerSource,
      created_from: createdFrom,
      created_to: createdTo,
    } = request.query;
    const decodedCursor = decodeTimestampIdCursor(cursor);
    if (cursor && !decodedCursor) {
      throw new ClientError('Invalid cursor', 'invalid-cursor', {status: 400});
    }

    const {project} = await requireProjectAccess({request, projectId});

    const filters = {
      status,
      definitionId,
      triggerSource,
      createdFrom: createdFrom ? new Date(createdFrom) : undefined,
      createdTo: createdTo ? new Date(createdTo) : undefined,
    };
    const result = await listWorkflowRuns({
      projectId: project.id,
      limit,
      cursor: decodedCursor,
      filters,
      includeTotal: !decodedCursor,
    });

    logger().info(
      {
        projectId: project.id,
        filterKeys: Object.entries(filters)
          .filter(([, value]) => value !== undefined)
          .map(([key]) => key),
        limit,
        cursorPresent: Boolean(cursor),
        resultCount: result.runs.length,
        nextCursorPresent: Boolean(result.nextCursor),
        durationMs: Math.round(performance.now() - startedAt),
      },
      'Listed workflow runs',
    );

    return {
      runs: result.runs.map(toRunDto),
      next_cursor: result.nextCursor ? encodeTimestampIdCursor(result.nextCursor) : null,
      filtered_total_count: result.filteredTotalCount,
    };
  },
});
