import {
  leasedWriteAnnotationsBodySchema,
  leasedWriteAnnotationsResponseSchema,
} from '@shipfox/annotations-dto';
import {requireLeasedJobContext} from '@shipfox/api-auth-context';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {
  AnnotationBodyTooLargeError,
  AnnotationCountLimitExceededError,
  AnnotationTotalBytesLimitExceededError,
} from '#core/errors.js';
import {writeAnnotations} from '#core/write-annotations.js';

export const writeAnnotationsRoute = defineRoute({
  method: 'POST',
  path: '/annotations',
  description: 'Creates, updates, or removes annotations for the current leased job execution.',
  schema: {
    body: leasedWriteAnnotationsBodySchema,
    response: {
      200: leasedWriteAnnotationsResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof AnnotationBodyTooLargeError) {
      throw new ClientError(error.message, 'annotation-body-too-large', {
        status: 413,
        details: {max_body_bytes: error.maxBytes},
      });
    }
    if (error instanceof AnnotationCountLimitExceededError) {
      throw new ClientError(error.message, 'annotation-count-limit-exceeded', {
        status: 413,
        details: {max_annotations: error.maxAnnotations},
      });
    }
    if (error instanceof AnnotationTotalBytesLimitExceededError) {
      throw new ClientError(error.message, 'annotation-total-bytes-limit-exceeded', {
        status: 413,
        details: {max_total_body_bytes: error.maxBytes},
      });
    }
    throw error;
  },
  handler: async (request) => {
    const leasedJob = requireLeasedJobContext(request);
    const {step_id: stepId, attempt, annotations} = request.body;

    if (leasedJob.currentStepId !== stepId || leasedJob.currentStepAttempt !== attempt) {
      throw new ClientError('Step not found for leased job execution', 'step-not-found', {
        status: 404,
      });
    }

    const result = await writeAnnotations({
      workspaceId: leasedJob.workspaceId,
      projectId: leasedJob.projectId,
      workflowRunId: leasedJob.workflowRunId,
      workflowRunAttemptId: leasedJob.workflowRunAttemptId,
      jobId: leasedJob.jobId,
      jobExecutionId: leasedJob.jobExecutionId,
      originStepId: stepId,
      originStepAttempt: attempt,
      operations: annotations,
    });

    return {
      annotations: result.annotations,
      accounting: {
        annotation_count: result.accounting.annotationCount,
        total_body_bytes: result.accounting.totalBodyBytes,
      },
    };
  },
});
