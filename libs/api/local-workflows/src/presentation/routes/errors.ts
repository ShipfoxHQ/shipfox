import {ClientError} from '@shipfox/node-fastify';
import {LocalWorkflowsError} from '#core/local-workflows.js';

export function localWorkflowsErrorHandler(error: unknown): never {
  if (error instanceof LocalWorkflowsError) {
    throw new ClientError(error.message, error.code, {
      status: error.status,
      details: error.details,
    });
  }
  throw error;
}
