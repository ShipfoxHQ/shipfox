import {
  type AgentThinking,
  getModelProviderEntry,
  type ModelProviderRef,
  type SupportedModelProviderId,
} from '@shipfox/api-agent-dto';
import {config} from '#config.js';
import {getAgentWorkspaceDefaultsSnapshot} from '#db/index.js';
import type {AgentConfigResolutionContext, AgentDefaultsResolver} from './resolve-agent-config.js';
import {resolveAgentConfig} from './resolve-agent-config.js';

export async function createWorkspaceAgentDefaultsResolver(
  workspaceId: string,
): Promise<AgentDefaultsResolver> {
  const snapshot = await getAgentWorkspaceDefaultsSnapshot(workspaceId);
  const workspaceModelProviderConfigs = new Map<
    SupportedModelProviderId,
    {defaultModel: string | null; defaultThinking: AgentThinking}
  >();
  for (const providerConfig of snapshot.providerConfigs) {
    const modelProviderId = toSupportedModelProviderId(providerConfig.modelProviderId);
    if (!modelProviderId) continue;

    workspaceModelProviderConfigs.set(modelProviderId, {
      defaultModel: providerConfig.defaultModel,
      defaultThinking: providerConfig.defaultThinking,
    });
  }
  const ctx: AgentConfigResolutionContext = {
    workspaceDefaultModelProviderId: snapshot.defaultModelProviderId
      ? toSupportedModelProviderId(snapshot.defaultModelProviderId)
      : null,
    workspaceModelProviderConfigs,
    instanceDefaultModelProvider: config.DEFAULT_MODEL_PROVIDER as
      | SupportedModelProviderId
      | undefined,
    instanceDefaultModelProviderModel: config.DEFAULT_MODEL_PROVIDER_MODEL,
    instanceDefaultModelProviderThinking: config.DEFAULT_MODEL_PROVIDER_THINKING as
      | AgentThinking
      | undefined,
  };

  return (step) => resolveAgentConfig(step, ctx);
}

function toSupportedModelProviderId(
  modelProviderId: ModelProviderRef,
): SupportedModelProviderId | undefined {
  const entry = getModelProviderEntry(modelProviderId);
  if (entry === undefined || entry.support_status !== 'supported') return undefined;
  return modelProviderId as SupportedModelProviderId;
}
