import {agentInterModuleContract} from '@shipfox/api-agent-dto/inter-module';
import {SecretDecryptionError} from '@shipfox/api-secrets';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModulePresentation,
} from '@shipfox/inter-module';
import {
  InvalidAgentModelError,
  ModelProviderConfigNotFoundError,
  UnsupportedHarnessProviderError,
  UnsupportedHarnessThinkingError,
  UnsupportedModelProviderError,
} from '#core/errors.js';
import {resolveAgentConfig} from '#core/resolve-agent-config.js';
import {resolveRuntimeCredentials} from '#core/resolve-runtime-credentials.js';
import {createWorkspaceAgentDefaultsResolver} from '#core/workspace-agent-defaults-resolver.js';
import type {AgentSecretsClient} from '#core/secrets-client.js';

export function createAgentInterModulePresentation(params: {secrets: AgentSecretsClient}): InterModulePresentation<
  typeof agentInterModuleContract
> {
  return defineInterModulePresentation(agentInterModuleContract, {
    resolveAgentConfig: async ({workspaceId, config}) => {
      try {
        const resolve =
          workspaceId === null
            ? resolveAgentConfig
            : await createWorkspaceAgentDefaultsResolver(workspaceId);
        return await resolve(config);
      } catch (error) {
        throw toResolveAgentConfigKnownError(error);
      }
    },
    resolveRuntimeCredentials: async (input) => {
      try {
        return await resolveRuntimeCredentials(input, {secrets: params.secrets});
      } catch (error) {
        throw toResolveRuntimeCredentialsKnownError(error);
      }
    },
  });
}

function toResolveAgentConfigKnownError(error: unknown): unknown {
  if (
    error instanceof InvalidAgentModelError ||
    error instanceof UnsupportedHarnessProviderError ||
    error instanceof UnsupportedHarnessThinkingError ||
    error instanceof UnsupportedModelProviderError
  ) {
    return createInterModuleKnownError(
      agentInterModuleContract.methods.resolveAgentConfig,
      'agent-config-invalid',
      {},
    );
  }
  return error;
}

function toResolveRuntimeCredentialsKnownError(error: unknown): unknown {
  if (error instanceof ModelProviderConfigNotFoundError) {
    return createInterModuleKnownError(
      agentInterModuleContract.methods.resolveRuntimeCredentials,
      'model-provider-not-configured',
      {},
    );
  }
  if (error instanceof SecretDecryptionError) {
    return createInterModuleKnownError(
      agentInterModuleContract.methods.resolveRuntimeCredentials,
      'model-provider-credentials-invalid',
      {},
    );
  }
  return error;
}
