import {
  type AgentModelOptionDto,
  type AgentThinking,
  DEFAULT_HARNESS,
  type Harness,
  type ManagedModelProvider,
  type ManagedModelThinkingLevelMap,
  MODEL_REFERENCE_ATTRIBUTION,
  type ModelPrice,
  type ModelReference,
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
import {listHarnessProviderModels} from './harness/index.js';
import {resolveAgentConfig} from './resolve-agent-config.js';
import {supportedThinkingForModel} from './supported-thinking.js';
import {getAgentValidationCatalogV2} from './validation-catalog.js';
import {workspaceAgentResolutionContext} from './workspace-agent-context.js';

interface WorkspaceModelCandidate {
  readonly id: string;
  readonly provider: string;
  readonly price: ModelPrice | null;
  readonly supportedThinking: readonly AgentThinking[];
  readonly references: readonly ModelReference[];
}

type WorkspaceModelOption = Pick<AgentModelOptionDto, 'id' | 'price' | 'references'> & {
  readonly supported_thinking?: readonly AgentThinking[] | undefined;
  readonly reasoning?: boolean | undefined;
  readonly thinkingLevelMap?: ManagedModelThinkingLevelMap | undefined;
  readonly thinking_level_map?: ManagedModelThinkingLevelMap | undefined;
};

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
  const candidates = configuredModels(
    catalog,
    snapshot.providerConfigs,
    managedProvider,
    workspaceProviders,
  );
  if (candidates.length === 0) return emptyWorkspaceModels();

  const resolutionContext = workspaceAgentResolutionContext(
    snapshot,
    managedProvider,
    workspaceProviders,
  );
  const defaultModel = resolveDefaultModel(candidates, resolutionContext);
  const models = candidates.map((candidate) => {
    const resolved = resolveAgentConfig(candidate, resolutionContext);
    const isDefault =
      defaultModel !== null &&
      candidate.id === defaultModel.id &&
      candidate.provider === defaultModel.provider;
    return {
      id: candidate.id,
      provider: candidate.provider,
      harness: resolved.harness,
      thinking: resolved.thinking,
      supported_thinking: [...candidate.supportedThinking],
      references: [...candidate.references],
      is_default: isDefault,
      price: candidate.price,
    } satisfies AgentWorkspaceModel;
  });

  return {
    models,
    default_model:
      defaultModel === null
        ? null
        : (models.find(
            ({id, provider}) => id === defaultModel.id && provider === defaultModel.provider,
          ) ?? null),
    attribution: models.some(({references}) => references.length > 0)
      ? MODEL_REFERENCE_ATTRIBUTION
      : null,
  };
}

function emptyWorkspaceModels(): AgentWorkspaceModels {
  return {models: [], default_model: null, attribution: null};
}

function configuredModels(
  catalog: AgentValidationCatalogV2,
  providerConfigs: readonly ModelProviderConfig[],
  managedProvider: ManagedModelProvider | undefined,
  workspaceProviders: WorkspaceProvidersPolicy | undefined,
): WorkspaceModelCandidate[] {
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
    ([provider, modelIds]) => {
      if (!configuredProviderIds.has(provider) || !supportedProviderIds.has(provider)) return [];

      if (managedProvider?.id === provider) {
        const managedModels = new Map(managedProvider.models.map((model) => [model.id, model]));
        return modelIds.flatMap((id) => {
          const model = managedModels.get(id);
          return model === undefined
            ? []
            : [modelCandidate(provider, catalog.default_harness_id, model)];
        });
      }

      const modelsById = new Map(
        listHarnessProviderModels(catalog.default_harness_id, provider).map((model) => [
          model.id,
          model,
        ]),
      );
      return modelIds.flatMap((id) => {
        const model = modelsById.get(id);
        return model === undefined
          ? []
          : [modelCandidate(provider, catalog.default_harness_id, model)];
      });
    },
  );
  if (workspaceProviders === 'disabled' || catalog.default_harness_id !== 'pi') {
    return catalogModels;
  }

  const customModels = providerConfigs.flatMap((providerConfig) =>
    providerConfig.kind === 'custom'
      ? (providerConfig.models ?? []).map((model) =>
          modelCandidate(providerConfig.providerId, catalog.default_harness_id, model),
        )
      : [],
  );
  return [...catalogModels, ...customModels];
}

function modelCandidate(
  provider: string,
  harness: Harness,
  model: WorkspaceModelOption,
): WorkspaceModelCandidate {
  const supportedThinking = model.supported_thinking ?? supportedThinkingForModel(harness, model);

  return {
    id: model.id,
    provider,
    price: model.price ?? null,
    supportedThinking,
    references: (model.references ?? []).filter(({thinking}) =>
      supportedThinking.includes(thinking),
    ),
  };
}

function resolveDefaultModel(
  models: readonly WorkspaceModelCandidate[],
  resolutionContext: Parameters<typeof resolveAgentConfig>[1],
): WorkspaceModelCandidate | null {
  try {
    const resolved = resolveAgentConfig({}, resolutionContext);
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
