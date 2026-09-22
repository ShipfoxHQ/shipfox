import {
  DEFAULT_HARNESS,
  type ManagedModelProvider,
  type WorkspaceProvidersPolicy,
} from '@shipfox/api-agent-dto';
import type {
  AgentValidationCatalogV2,
  AgentWorkspaceModel,
  AgentWorkspaceModels,
} from '@shipfox/api-agent-dto/inter-module';
import {getAgentWorkspaceDefaultsSnapshot} from '#db/index.js';
import type {ModelProviderConfig} from './entities/model-provider-config.js';
import {
  InvalidAgentModelError,
  UnsupportedHarnessProviderError,
  UnsupportedHarnessThinkingError,
  UnsupportedModelProviderError,
  WorkspaceProvidersDisabledError,
} from './errors.js';
import {resolveAgentConfig} from './resolve-agent-config.js';
import {getAgentValidationCatalogV2} from './validation-catalog.js';
import {workspaceAgentResolutionContext} from './workspace-agent-context.js';

export async function getWorkspaceModels(
  workspaceId: string,
  managedProvider?: ManagedModelProvider | undefined,
  workspaceProviders?: WorkspaceProvidersPolicy | undefined,
): Promise<AgentWorkspaceModels> {
  const snapshot = await getAgentWorkspaceDefaultsSnapshot(workspaceId);
  const catalog = getAgentValidationCatalogV2(
    managedProvider,
    workspaceProviders,
    snapshot.defaultHarnessId ?? DEFAULT_HARNESS,
  );
  const models = configuredModels(
    catalog,
    snapshot.providerConfigs,
    managedProvider,
    workspaceProviders,
  );
  if (models.length === 0) return {models, default_model: null};

  const defaultModel = resolveDefaultModel(models, snapshot, managedProvider, workspaceProviders);
  return {models, default_model: defaultModel};
}

function configuredModels(
  catalog: AgentValidationCatalogV2,
  providerConfigs: readonly ModelProviderConfig[],
  managedProvider: ManagedModelProvider | undefined,
  workspaceProviders: WorkspaceProvidersPolicy | undefined,
): AgentWorkspaceModel[] {
  const harness = catalog.harnesses.find(({id}) => id === catalog.default_harness_id);
  if (harness?.model_ids_by_provider === undefined) return [];

  const configuredProviderIds = new Set<string>();
  if (workspaceProviders !== 'disabled') {
    for (const providerConfig of providerConfigs) {
      if (providerConfig.kind === 'builtin') configuredProviderIds.add(providerConfig.providerId);
    }
  }
  if (managedProvider !== undefined) configuredProviderIds.add(managedProvider.id);

  const supportedProviderIds = new Set(
    catalog.providers
      .filter(({support_status: supportStatus}) => supportStatus === 'supported')
      .map(({id}) => id),
  );

  const catalogModels = Object.entries(harness.model_ids_by_provider).flatMap(
    ([provider, modelIds]) =>
      configuredProviderIds.has(provider) && supportedProviderIds.has(provider)
        ? modelIds.map((id) => ({id, provider}))
        : [],
  );
  if (workspaceProviders === 'disabled' || catalog.default_harness_id !== 'pi') {
    return catalogModels;
  }

  const customModels = providerConfigs.flatMap((providerConfig) =>
    providerConfig.kind === 'custom'
      ? (providerConfig.models ?? []).map(({id}) => ({id, provider: providerConfig.providerId}))
      : [],
  );
  return [...catalogModels, ...customModels];
}

function resolveDefaultModel(
  models: readonly AgentWorkspaceModel[],
  snapshot: Awaited<ReturnType<typeof getAgentWorkspaceDefaultsSnapshot>>,
  managedProvider: ManagedModelProvider | undefined,
  workspaceProviders: WorkspaceProvidersPolicy | undefined,
): AgentWorkspaceModel | null {
  try {
    const resolved = resolveAgentConfig(
      {},
      workspaceAgentResolutionContext(snapshot, managedProvider, workspaceProviders),
    );
    return (
      models.find(({id, provider}) => id === resolved.model && provider === resolved.provider) ??
      null
    );
  } catch (error) {
    if (isExpectedResolutionError(error)) return null;
    throw error;
  }
}

function isExpectedResolutionError(error: unknown): boolean {
  return (
    error instanceof InvalidAgentModelError ||
    error instanceof UnsupportedHarnessProviderError ||
    error instanceof UnsupportedHarnessThinkingError ||
    error instanceof UnsupportedModelProviderError ||
    error instanceof WorkspaceProvidersDisabledError
  );
}
