import {readAnnotationsResponseSchema} from '@shipfox/annotations-dto';
import {requireUserContext} from '@shipfox/api-auth-context';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {listAnnotationsForRunAttempt} from '#db/index.js';
import {toAnnotationDto} from '#presentation/dto/index.js';

export const readAnnotationsRoute = defineRoute({
  method: 'GET',
  path: '/',
  description: 'Read annotations for a workflow run attempt.',
  schema: {
    querystring: z.object({
      workflow_run_id: z.string().uuid(),
      attempt: z.coerce.number().int().min(1),
      job_execution_id: z.string().uuid().optional(),
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
    } = request.query;
    const workspaceIds = user.memberships.map((membership) => membership.workspaceId);
    const annotations = await listAnnotationsForRunAttempt({
      workflowRunId,
      workflowRunAttempt: attempt,
      workspaceIds,
      jobExecutionId,
    });

    return {annotations: annotations.map(toAnnotationDto)};
  },
});
