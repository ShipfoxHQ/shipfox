import type {
  AgentThinking,
  ManagedModelProvider,
  ModelProviderRef,
  WorkspaceProvidersPolicy,
} from '@shipfox/api-agent-dto';
import {config} from '#config.js';
import type {AgentWorkspaceDefaultsSnapshot} from '#db/index.js';
import type {AgentConfigResolutionContext} from './resolve-agent-config.js';

export function workspaceAgentResolutionContext(
  snapshot: AgentWorkspaceDefaultsSnapshot,
  managedProvider?: ManagedModelProvider | undefined,
  workspaceProviders?: WorkspaceProvidersPolicy | undefined,
): AgentConfigResolutionContext {
  const workspaceProviderConfigs = new Map<
    ModelProviderRef,
    {
      kind: 'builtin' | 'custom';
      defaultModel: string | null;
      defaultThinking: AgentThinking;
      models: (typeof snapshot.providerConfigs)[number]['models'];
    }
  >();
  for (const providerConfig of snapshot.providerConfigs) {
    workspaceProviderConfigs.set(providerConfig.providerId, {
      kind: providerConfig.kind,
      defaultModel: providerConfig.defaultModel,
      defaultThinking: providerConfig.defaultThinking,
      models: providerConfig.models,
    });
  }

  return {
    workspaceDefaultHarnessId: snapshot.defaultHarnessId ?? null,
    workspaceDefaultProviderId: snapshot.defaultProviderId ?? null,
    workspaceProviderConfigs,
    instanceDefaultProvider: config.AGENT_DEFAULT_PROVIDER,
    instanceDefaultModel: config.AGENT_DEFAULT_PROVIDER_MODEL,
    instanceDefaultThinking: config.AGENT_DEFAULT_PROVIDER_THINKING as AgentThinking | undefined,
    managedProvider,
    workspaceProviders,
  };
}
