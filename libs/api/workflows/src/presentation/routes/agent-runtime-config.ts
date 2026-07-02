import {
  CredentialDecryptionError,
  ModelProviderConfigNotFoundError,
} from '@shipfox/api-agent/core/errors';
import {resolveRuntimeCredentials} from '@shipfox/api-agent/core/resolve-runtime-credentials';
import {
  agentRuntimeCredentialsResponseSchema,
  type MaterializedAgentStepConfigDto,
  materializedAgentStepConfigSchema,
} from '@shipfox/api-agent-dto';
import {requireLeasedJobContext} from '@shipfox/api-auth-context';
import {isJobLeaseActive} from '@shipfox/api-runners';
import {agentRuntimeConfigQuerySchema} from '@shipfox/api-workflows-dto';
import {captureException} from '@shipfox/node-error-monitoring';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {ZodError} from 'zod';
import {getJobWorkspaceId, getStepByIdForJobExecution} from '#db/index.js';

export const agentRuntimeConfigRoute = defineRoute({
  method: 'GET',
  path: '/agent-runtime-config',
  description:
    "Returns the resolved model provider, model, thinking effort, and decrypted model provider credential bundle for the runner's currently leased running agent step. The job is identified by the lease token and the step is bound to that job before credentials are returned.",
  schema: {
    querystring: agentRuntimeConfigQuerySchema,
    response: {
      200: agentRuntimeCredentialsResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof CredentialDecryptionError) {
      captureException(error);
      throw new ClientError(
        'Model provider credentials could not be decrypted',
        'model-provider-credentials-invalid',
        {
          status: 409,
          cause: error,
        },
      );
    }
    if (error instanceof ModelProviderConfigNotFoundError) {
      throw new ClientError(
        'Model provider credentials are not configured',
        'model-provider-not-configured',
        {
          status: 409,
        },
      );
    }
    throw error;
  },
  handler: async (request, reply) => {
    const leasedJob = requireLeasedJobContext(request);
    const {step_id: stepId, attempt} = request.query;

    const step = await getStepByIdForJobExecution({
      stepId,
      jobExecutionId: leasedJob.jobExecutionId,
    });
    if (!step) {
      throw new ClientError('Step not found for leased job', 'step-not-found', {status: 404});
    }
    const workspaceId = await getJobWorkspaceId(leasedJob.jobId);
    if (!workspaceId) {
      throw new ClientError('Leased job not found', 'job-not-found', {status: 404});
    }
    const leaseIsActive = await isJobLeaseActive({
      jobId: leasedJob.jobId,
      jobExecutionId: leasedJob.jobExecutionId,
      runnerSessionId: leasedJob.runnerSessionId,
    });
    if (!leaseIsActive) {
      throw new ClientError('Job lease is no longer active', 'lease-not-active', {status: 404});
    }
    if (step.currentAttempt !== attempt) {
      throw new ClientError(
        'Step attempt does not match current attempt',
        'step-attempt-mismatch',
        {
          status: 409,
        },
      );
    }
    if (step.status !== 'running') {
      throw new ClientError('Step is not running', 'step-not-running', {status: 409});
    }
    if (step.type !== 'agent') {
      throw new ClientError('Step is not an agent step', 'step-not-agent', {status: 409});
    }

    let agentConfig: MaterializedAgentStepConfigDto;
    try {
      agentConfig = materializedAgentStepConfigSchema.parse(step.config);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ClientError('Agent step config is invalid', 'agent-step-config-invalid', {
          status: 409,
          cause: error,
        });
      }
      throw error;
    }

    const runtimeConfig = await resolveRuntimeCredentials({
      workspaceId,
      modelProvider: agentConfig.provider,
      model: agentConfig.model,
      thinking: agentConfig.thinking,
    });

    reply.header('cache-control', 'no-store');
    return runtimeConfig;
  },
});
