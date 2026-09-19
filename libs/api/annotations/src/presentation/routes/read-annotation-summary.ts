import {
  annotationSummaryResponseSchema,
  readAnnotationsQuerySchema,
} from '@shipfox/annotations-dto';
import {requireUserContext} from '@shipfox/api-auth-context';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import {summarizeAnnotationsForRunAttempt} from '#db/index.js';

export const readAnnotationSummaryRoute = defineRoute({
  method: 'GET',
  path: '/summary',
  description: 'Read annotation counts for a workflow run attempt.',
  schema: {
    querystring: readAnnotationsQuerySchema.omit({cursor: true, limit: true}),
    response: {
      200: annotationSummaryResponseSchema,
    },
  },
  handler: async (request) => {
    const user = requireUserContext(request);
    const {
      workflow_run_id: workflowRunId,
      attempt,
      job_execution_id: jobExecutionId,
    } = request.query;
    const startedAt = performance.now();
    let databaseDurationMilliseconds = 0;
    let resultCount = 0;
    let responseStatus = 200;
    let outcome: 'success' | 'error' = 'success';

    try {
      const workspaceIds = user.memberships
        .filter((membership) => membership.workspaceStatus === 'active')
        .map((membership) => membership.workspaceId);
      const summary = await summarizeAnnotationsForRunAttempt(
        {
          workflowRunId,
          workflowRunAttempt: attempt,
          workspaceIds,
          jobExecutionId,
        },
        {
          onRead: (measurement) => {
            databaseDurationMilliseconds = measurement.databaseDurationMilliseconds;
          },
        },
      );
      resultCount = summary.total;

      return {
        total: summary.total,
        error: summary.error,
        warning: summary.warning,
        info: summary.info,
        success: summary.success,
        step_counts: summary.stepCounts.map((step) => ({
          origin_step_id: step.originStepId,
          origin_step_attempt: step.originStepAttempt,
          total: step.total,
        })),
      };
    } catch (error) {
      responseStatus =
        error instanceof ClientError && typeof error.status === 'number' ? error.status : 500;
      outcome = 'error';
      throw error;
    } finally {
      logger().info(
        {
          route: 'annotations/summary',
          status: responseStatus,
          outcome,
          runId: workflowRunId,
          attempt,
          jobExecutionId,
          resultCount,
          databaseDurationMs: Math.round(databaseDurationMilliseconds),
          durationMs: Math.round(performance.now() - startedAt),
        },
        'Read annotation summary',
      );
    }
  },
});
