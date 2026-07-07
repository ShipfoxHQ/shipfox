import {readAnnotationsQuerySchema, readAnnotationsResponseSchema} from '@shipfox/annotations-dto';
import {requireUserContext} from '@shipfox/api-auth-context';
import {defineRoute} from '@shipfox/node-fastify';
import {listAnnotationsForRunAttempt} from '#db/index.js';
import {toAnnotationDto} from '#presentation/dto/index.js';

export const readAnnotationsRoute = defineRoute({
  method: 'GET',
  path: '/',
  description: 'Read annotations for a workflow run attempt.',
  schema: {
    querystring: readAnnotationsQuerySchema,
    response: {
      200: readAnnotationsResponseSchema,
    },
  },
  handler: async (request) => {
    const user = requireUserContext(request);
    const {
      workflow_run_id: workflowRunId,
      attempt,
      job_execution_id: jobExecutionId,
      limit,
    } = request.query;
    const workspaceIds = user.memberships.map((membership) => membership.workspaceId);
    const result = await listAnnotationsForRunAttempt({
      workflowRunId,
      workflowRunAttempt: attempt,
      workspaceIds,
      jobExecutionId,
      limit,
    });

    return {annotations: result.annotations.map(toAnnotationDto), has_more: result.hasMore};
  },
});
