import {ModelProviderConfigNotFoundError} from '@shipfox/api-agent/core/errors';
import {resolveRuntimeCredentials} from '@shipfox/api-agent/core/resolve-runtime-credentials';
import {
  agentRuntimeCredentialsResponseSchema,
  type MaterializedAgentStepConfigDto,
  materializedAgentStepConfigSchema,
} from '@shipfox/api-agent-dto';
import {SecretDecryptionError} from '@shipfox/api-secrets';
import {agentRuntimeConfigQuerySchema} from '@shipfox/api-workflows-dto';
import {captureException} from '@shipfox/node-error-monitoring';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {ZodError} from 'zod';
import {loadRunningLeasedStep} from './leased-step.js';

export const agentRuntimeConfigRoute = defineRoute({
  method: 'GET',
  path: '/agent-runtime-config',
  description:
    "Returns the resolved provider, model, thinking effort, and decrypted provider credential bundle for the runner's currently leased running agent step. The job is identified by the lease token and the step is bound to that job before credentials are returned.",
  schema: {
    querystring: agentRuntimeConfigQuerySchema,
    response: {
      200: agentRuntimeCredentialsResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof SecretDecryptionError) {
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
    const {step_id: stepId, attempt} = request.query;
    const {step, workspaceId} = await loadRunningLeasedStep({request, stepId, attempt});

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
      provider: agentConfig.provider,
      model: agentConfig.model,
      thinking: agentConfig.thinking,
    });

    reply.header('cache-control', 'no-store');
    return runtimeConfig;
  },
});
