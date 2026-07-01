import {
  type AgentProviderRef,
  type AgentThinking,
  getAgentProviderEntry,
  type SupportedAgentProviderId,
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
    SupportedAgentProviderId,
    {defaultModel: string | null; defaultThinking: AgentThinking}
  >();
  for (const providerConfig of snapshot.providerConfigs) {
    const providerId = toSupportedProviderId(providerConfig.providerId);
    if (!providerId) continue;

    workspaceProviderConfigs.set(providerId, {
      defaultModel: providerConfig.defaultModel,
      defaultThinking: providerConfig.defaultThinking,
    });
  }
  const ctx: AgentConfigResolutionContext = {
    workspaceDefaultProviderId: snapshot.defaultProviderId
      ? toSupportedProviderId(snapshot.defaultProviderId)
      : null,
    workspaceProviderConfigs,
    instanceDefaultProvider: config.AGENT_DEFAULT_PROVIDER as SupportedAgentProviderId | undefined,
    instanceDefaultProviderModel: config.AGENT_DEFAULT_PROVIDER_MODEL,
    instanceDefaultProviderThinking: config.AGENT_DEFAULT_PROVIDER_THINKING as
      | AgentThinking
      | undefined,
  };

  return (step) => resolveAgentConfig(step, ctx);
}

function toSupportedProviderId(providerId: AgentProviderRef): SupportedAgentProviderId | undefined {
  const entry = getAgentProviderEntry(providerId);
  if (entry === undefined || entry.support_status !== 'supported') return undefined;
  return providerId as SupportedAgentProviderId;
}
