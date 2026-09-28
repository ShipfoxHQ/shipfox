import {Buffer} from 'node:buffer';
import {requireLeasedJobContext} from '@shipfox/api-auth-context';
import {
  type DefinitionsInterModuleClient,
  definitionsInterModuleContract,
} from '@shipfox/api-definitions-dto/inter-module';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {actionBundleDigestSchema} from '@shipfox/workflow-document';
import {z} from 'zod';
import {loadRunningLeasedStep} from './leased-step.js';

const actionStepConfigSchema = z.object({action: z.object({digest: actionBundleDigestSchema})});

export function createGetActionBundleRoute(params: {
  runners: RunnersInterModuleClient;
  definitions: DefinitionsInterModuleClient;
}) {
  return defineRoute({
    method: 'GET',
    path: '/steps/:stepId/action-bundle',
    description:
      "Returns the gzipped action bundle for the runner's currently leased action step. The digest comes from the step config, never from the runner.",
    schema: {
      params: z.object({stepId: z.string().uuid()}),
      response: {
        200: z.instanceof(Buffer),
      },
    },
    errorHandler: (error) => {
      if (
        isInterModuleKnownError(definitionsInterModuleContract.methods.getActionSnapshot, error)
      ) {
        throw new ClientError('Action snapshot not found', 'action-snapshot-not-found', {
          status: 404,
          cause: error,
        });
      }
      throw error;
    },
    handler: async (request, reply) => {
      const {stepId} = request.params;
      const leasedJob = requireLeasedJobContext(request);
      if (leasedJob.currentStepId !== stepId || leasedJob.currentStepAttempt === undefined) {
        throw new ClientError('Step is not the current leased step', 'step-not-current', {
          status: 409,
        });
      }

      const {step, workspaceId} = await loadRunningLeasedStep({
        runners: params.runners,
        request,
        stepId,
        attempt: leasedJob.currentStepAttempt,
      });
      if (step.type !== 'action') {
        throw new ClientError('Step is not an action step', 'step-not-action', {status: 409});
      }

      const config = actionStepConfigSchema.safeParse(step.config);
      if (!config.success) {
        throw new ClientError('Action step config is invalid', 'action-config-invalid', {
          status: 409,
          cause: config.error,
        });
      }

      const snapshot = await params.definitions.getActionSnapshot({
        workspaceId,
        digest: config.data.action.digest,
      });

      reply.header('cache-control', 'no-store');
      reply.type('application/gzip');
      return Buffer.from(snapshot.bundleGzipBase64, 'base64');
    },
  });
}
