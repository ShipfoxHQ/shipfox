import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {
  type AgentValidationCatalogV2,
  agentInterModuleContract,
} from '@shipfox/api-agent-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';

export interface AgentAccessWorkspaceModel {
  readonly id: string;
  readonly provider: string;
}

export interface AgentAccessWorkspaceModels {
  readonly models: readonly AgentAccessWorkspaceModel[];
  readonly default_model: AgentAccessWorkspaceModel | null;
}

/**
 * Reads the models available to a workspace and its resolved default model.
 * A provider that cannot be resolved is represented as an empty default rather
 * than making a workspace with no usable provider fail the read.
 */
export async function getWorkspaceModels(
  agent: AgentInterModuleClient,
  workspaceId: string,
): Promise<AgentAccessWorkspaceModels> {
  const catalog = await agent.getValidationCatalogV2({workspaceId});
  const models = modelsFromCatalog(catalog);
  if (models.length === 0) return {models, default_model: null};

  const defaultModel = await resolveDefaultModel(agent, workspaceId, models);
  return {models, default_model: defaultModel};
}

function modelsFromCatalog(catalog: AgentValidationCatalogV2): AgentAccessWorkspaceModel[] {
  const supportedProviders = new Set(
    catalog.providers
      .filter((provider) => provider.support_status === 'supported')
      .map((provider) => provider.id),
  );
  const harness = catalog.harnesses.find(({id}) => id === catalog.default_harness_id);
  if (harness?.model_ids_by_provider === undefined) return [];

  return Object.entries(harness.model_ids_by_provider).flatMap(([provider, modelIds]) =>
    supportedProviders.has(provider) ? modelIds.map((id) => ({id, provider})) : [],
  );
}

async function resolveDefaultModel(
  agent: AgentInterModuleClient,
  workspaceId: string,
  models: readonly AgentAccessWorkspaceModel[],
): Promise<AgentAccessWorkspaceModel | null> {
  try {
    const resolved = await agent.resolveAgentConfig({workspaceId, config: {}});
    return (
      models.find(({id, provider}) => id === resolved.model && provider === resolved.provider) ??
      null
    );
  } catch (error) {
    if (isInterModuleKnownError(agentInterModuleContract.methods.resolveAgentConfig, error)) {
      return null;
    }
    throw error;
  }
}
