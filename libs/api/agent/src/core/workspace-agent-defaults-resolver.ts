import type {AgentThinking, SupportedAgentProviderId} from '@shipfox/api-agent-dto';
import {config} from '#config.js';
import {getAgentWorkspaceDefaultsSnapshot} from '#db/index.js';
import type {AgentConfigResolutionContext, AgentDefaultsResolver} from './resolve-agent-config.js';
import {resolveAgentConfig} from './resolve-agent-config.js';

export async function createWorkspaceAgentDefaultsResolver(
  workspaceId: string,
): Promise<AgentDefaultsResolver> {
  const snapshot = await getAgentWorkspaceDefaultsSnapshot(workspaceId);
  const workspaceProviderConfigs = new Map(
    snapshot.providerConfigs.map((providerConfig) => [
      providerConfig.providerId,
      {
        defaultModel: providerConfig.defaultModel,
        defaultThinking: providerConfig.defaultThinking,
      },
    ]),
  );
  const ctx: AgentConfigResolutionContext = {
    workspaceDefaultProviderId: snapshot.defaultProviderId,
    workspaceProviderConfigs,
    instanceDefaultProvider: config.AGENT_DEFAULT_PROVIDER as SupportedAgentProviderId | undefined,
    instanceDefaultProviderModel: config.AGENT_DEFAULT_PROVIDER_MODEL,
    instanceDefaultProviderThinking: config.AGENT_DEFAULT_PROVIDER_THINKING as
      | AgentThinking
      | undefined,
  };

  return (step) => resolveAgentConfig(step, ctx);
}
