import {
  type ManagedModelProvider,
  MODEL_UNAVAILABLE_ERROR_CODE,
  type ModelUnavailableDetails,
  modelUnavailableDetailsSchema,
  RUNNER_CAPABILITY_REQUIRED_ERROR_CODE,
  type WorkspaceProvidersPolicy,
} from '@shipfox/api-agent-dto';
import {agentInterModuleContract} from '@shipfox/api-agent-dto/inter-module';
import {secretsInterModuleContract} from '@shipfox/api-secrets-dto/inter-module';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModulePresentation,
  isInterModuleKnownError,
} from '@shipfox/inter-module';
import {claimStepSession} from '#core/claim-step-session.js';
import {
  AgentSessionCarryOverConflictError,
  AgentSessionHarnessMismatchError,
  AgentSessionHeldError,
  AgentSessionKeyInvalidError,
  AgentSessionLockUnavailableError,
  isAgentConfigResolutionError,
  ManagedModelAvailabilityError,
  ModelProviderConfigNotFoundError,
  WorkspaceProvidersDisabledError,
} from '#core/errors.js';
import {resolveAgentConfig} from '#core/resolve-agent-config.js';
import {resolveRuntimeCredentials} from '#core/resolve-runtime-credentials.js';
import type {AgentSecretsClient} from '#core/secrets-client.js';
import {getAgentValidationCatalog, getAgentValidationCatalogV2} from '#core/validation-catalog.js';
import {
  createWorkspaceAgentDefaultsResolver,
  getWorkspaceAgentValidationCatalog,
} from '#core/workspace-agent-defaults-resolver.js';
import {getWorkspaceModels} from '#core/workspace-models.js';
import {carryOverSessions, releaseSession} from '#db/index.js';

export function createAgentInterModulePresentation(params: {
  secrets: AgentSecretsClient;
  managedProvider?: ManagedModelProvider | undefined;
  workspaceProviders?: WorkspaceProvidersPolicy | undefined;
}): InterModulePresentation<typeof agentInterModuleContract> {
  return defineInterModulePresentation(agentInterModuleContract, {
    getValidationCatalog: () =>
      getAgentValidationCatalog(params.managedProvider, params.workspaceProviders),
    getValidationCatalogV2: async ({workspaceId}) =>
      workspaceId === null
        ? getAgentValidationCatalogV2(params.managedProvider, params.workspaceProviders)
        : await getWorkspaceAgentValidationCatalog(
            workspaceId,
            params.managedProvider,
            params.workspaceProviders,
          ),
    getWorkspaceModels: async ({workspaceId}) =>
      await getWorkspaceModels(workspaceId, params.managedProvider, params.workspaceProviders),
    resolveAgentConfig: async ({workspaceId, config}) => {
      try {
        const resolve =
          workspaceId === null
            ? (step: Parameters<typeof resolveAgentConfig>[0]) =>
                resolveAgentConfig(step, {
                  managedProvider: params.managedProvider,
                  workspaceProviders: params.workspaceProviders,
                })
            : await createWorkspaceAgentDefaultsResolver(
                workspaceId,
                params.managedProvider,
                params.workspaceProviders,
              );
        return await resolve(config);
      } catch (error) {
        throw toResolveAgentConfigKnownError(error);
      }
    },
    resolveRuntimeCredentials: async (input) => {
      try {
        return await resolveRuntimeCredentials(input, {
          managedProvider: params.managedProvider,
          secrets: params.secrets,
          workspaceProviders: params.workspaceProviders,
        });
      } catch (error) {
        throw toResolveRuntimeCredentialsKnownError(error);
      }
    },
    claimSession: async (input) => {
      try {
        return await claimStepSession({
          ...input,
          // Older callers resolve a harness and must keep the mismatch guard.
          // Only the new explicit false value requests session-pin inheritance.
          harnessExplicit: input.harnessExplicit ?? true,
        });
      } catch (error) {
        throw toClaimSessionKnownError(error);
      }
    },
    releaseSession: async (input) => ({
      released: await releaseSession(input),
    }),
    carryOverSessions: async (input) => {
      try {
        const carried = await carryOverSessions(input);
        return {
          sessions: carried.map((session) => ({
            id: session.id,
            key: session.key,
            segment: session.headSegment,
          })),
        };
      } catch (error) {
        throw toCarryOverSessionsKnownError(error);
      }
    },
  });
}

function toResolveAgentConfigKnownError(error: unknown): unknown {
  if (isAgentConfigResolutionError(error)) {
    return createInterModuleKnownError(
      agentInterModuleContract.methods.resolveAgentConfig,
      'agent-config-invalid',
      {
        ...(error instanceof WorkspaceProvidersDisabledError
          ? {message: error.message, managed_provider_id: error.managedProviderId}
          : {}),
      },
    );
  }
  return error;
}

function toResolveRuntimeCredentialsKnownError(error: unknown): unknown {
  if (isRunnerCapabilityRequiredError(error)) {
    return createInterModuleKnownError(
      agentInterModuleContract.methods.resolveRuntimeCredentials,
      RUNNER_CAPABILITY_REQUIRED_ERROR_CODE,
      {},
    );
  }
  const modelUnavailable = parseModelUnavailableError(error);
  if (modelUnavailable !== undefined) {
    return createInterModuleKnownError(
      agentInterModuleContract.methods.resolveRuntimeCredentials,
      MODEL_UNAVAILABLE_ERROR_CODE,
      modelUnavailable,
    );
  }
  if (error instanceof ManagedModelAvailabilityError) {
    return createInterModuleKnownError(
      agentInterModuleContract.methods.resolveRuntimeCredentials,
      'model-availability-unavailable',
      {},
    );
  }
  if (error instanceof WorkspaceProvidersDisabledError) {
    return createInterModuleKnownError(
      agentInterModuleContract.methods.resolveRuntimeCredentials,
      'workspace-providers-disabled',
      {
        message: error.message,
        managed_provider_id: error.managedProviderId,
      },
    );
  }
  if (error instanceof ModelProviderConfigNotFoundError) {
    return createInterModuleKnownError(
      agentInterModuleContract.methods.resolveRuntimeCredentials,
      'model-provider-not-configured',
      {},
    );
  }
  if (isInterModuleKnownError(secretsInterModuleContract.methods.getSecretsByNamespace, error)) {
    return createInterModuleKnownError(
      agentInterModuleContract.methods.resolveRuntimeCredentials,
      'model-provider-credentials-invalid',
      {},
    );
  }
  return error;
}

function parseModelUnavailableError(error: unknown): ModelUnavailableDetails | undefined {
  // Managed providers are extension points, so identify this contract error by its stable code.
  if (
    !(error instanceof Error) ||
    !('code' in error) ||
    error.code !== MODEL_UNAVAILABLE_ERROR_CODE
  ) {
    return undefined;
  }
  const details = modelUnavailableDetailsSchema.safeParse(error);
  return details.success ? details.data : undefined;
}

function isRunnerCapabilityRequiredError(
  error: unknown,
): error is Error & {readonly code: typeof RUNNER_CAPABILITY_REQUIRED_ERROR_CODE} {
  // Managed providers are extension points, so identify this contract error by its stable code.
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === RUNNER_CAPABILITY_REQUIRED_ERROR_CODE
  );
}

function toClaimSessionKnownError(error: unknown): unknown {
  const method = agentInterModuleContract.methods.claimSession;
  if (error instanceof AgentSessionKeyInvalidError) {
    return createInterModuleKnownError(method, 'session-key-invalid', {});
  }
  if (error instanceof AgentSessionHeldError) {
    return createInterModuleKnownError(method, 'session-held', {
      ...(error.scopeMismatch || error.heldByStepAttempt === null
        ? {}
        : {holder: {sessionId: error.sessionId, stepAttemptId: error.heldByStepAttempt}}),
    });
  }
  if (error instanceof AgentSessionHarnessMismatchError) {
    return createInterModuleKnownError(method, 'session-harness-mismatch', {});
  }
  if (error instanceof AgentSessionLockUnavailableError) {
    return createInterModuleKnownError(method, 'session-lock-unavailable', {});
  }
  return error;
}

function toCarryOverSessionsKnownError(error: unknown): unknown {
  if (error instanceof AgentSessionCarryOverConflictError) {
    return createInterModuleKnownError(
      agentInterModuleContract.methods.carryOverSessions,
      'carry-over-conflict',
      {},
    );
  }
  return error;
}
