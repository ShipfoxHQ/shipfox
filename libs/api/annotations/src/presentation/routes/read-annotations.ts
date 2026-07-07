import {readAnnotationsResponseSchema} from '@shipfox/annotations-dto';
import {requireUserContext} from '@shipfox/api-auth-context';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {DEFAULT_ANNOTATIONS_READ_LIMIT, listAnnotationsForRunAttempt} from '#db/index.js';
import {toAnnotationDto} from '#presentation/dto/index.js';

const POSTGRES_INTEGER_MAX = 2_147_483_647;

export const readAnnotationsRoute = defineRoute({
  method: 'GET',
  path: '/',
  description: 'Read annotations for a workflow run attempt.',
  schema: {
    querystring: z.object({
      workflow_run_id: z.string().uuid(),
      attempt: z.coerce.number().int().min(1).max(POSTGRES_INTEGER_MAX),
      job_execution_id: z.string().uuid().optional(),
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(DEFAULT_ANNOTATIONS_READ_LIMIT)
        .default(DEFAULT_ANNOTATIONS_READ_LIMIT),
    }),
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
