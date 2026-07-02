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
  const workspaceProviderConfigs = new Map<
    SupportedModelProviderId,
    {defaultModel: string | null; defaultThinking: AgentThinking}
  >();
  for (const providerConfig of snapshot.providerConfigs) {
    const providerId = toSupportedModelProviderId(providerConfig.providerId);
    if (!providerId) continue;

    workspaceProviderConfigs.set(providerId, {
      defaultModel: providerConfig.defaultModel,
      defaultThinking: providerConfig.defaultThinking,
    });
  }
  const ctx: AgentConfigResolutionContext = {
    workspaceDefaultProviderId: snapshot.defaultProviderId
      ? toSupportedModelProviderId(snapshot.defaultProviderId)
      : null,
    workspaceProviderConfigs,
    instanceDefaultProvider: config.AGENT_DEFAULT_PROVIDER as SupportedModelProviderId | undefined,
    instanceDefaultModel: config.AGENT_DEFAULT_PROVIDER_MODEL,
    instanceDefaultThinking: config.AGENT_DEFAULT_PROVIDER_THINKING as AgentThinking | undefined,
  };

  return (step) => resolveAgentConfig(step, ctx);
}

function toSupportedModelProviderId(
  providerId: ModelProviderRef,
): SupportedModelProviderId | undefined {
  const entry = getModelProviderEntry(providerId);
  if (entry === undefined || entry.support_status !== 'supported') return undefined;
  return providerId as SupportedModelProviderId;
}
