import {getModels, type KnownProvider} from '@earendil-works/pi-ai';
import {
  type AgentThinking,
  DEFAULT_AGENT_PROVIDER,
  DEFAULT_AGENT_THINKING,
  getAgentProviderEntry,
  type SupportedAgentProviderId,
} from '@shipfox/api-agent-dto';
import {config} from '#config.js';
import {getAgentWorkspaceSettings, listAgentProviderConfigs} from '#db/index.js';
import {InvalidAgentModelError, UnsupportedAgentProviderError} from './errors.js';

export interface ContextualAgentConfig {
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  readonly thinking?: AgentThinking | undefined;
}

export interface ResolvedAgentConfig {
  readonly provider: SupportedAgentProviderId;
  readonly model: string;
  readonly thinking: AgentThinking;
}

export type AgentDefaultsResolver = (step: ContextualAgentConfig) => ResolvedAgentConfig;

export interface AgentConfigResolutionContext {
  readonly workspaceDefaultProviderId?: SupportedAgentProviderId | null | undefined;
  readonly workspaceProviderConfigs?: ReadonlyMap<
    SupportedAgentProviderId,
    WorkspaceProviderDefaults
  >;
  readonly instanceDefaultProvider?: SupportedAgentProviderId | undefined;
  readonly instanceDefaultProviderModel?: string | undefined;
  readonly instanceDefaultProviderThinking?: AgentThinking | undefined;
}

interface WorkspaceProviderDefaults {
  readonly defaultModel: string;
  readonly defaultThinking: AgentThinking;
}

export function resolveAgentConfig(
  step: ContextualAgentConfig,
  ctx: AgentConfigResolutionContext = {},
): ResolvedAgentConfig {
  const provider = resolveProvider(step, ctx);
  const workspaceProviderConfig = ctx.workspaceProviderConfigs?.get(provider);
  const model =
    step.model ??
    workspaceProviderConfig?.defaultModel ??
    instanceDefaultModel(provider, ctx) ??
    catalogDefaultModel(provider);
  const thinking =
    step.thinking ??
    workspaceProviderConfig?.defaultThinking ??
    instanceDefaultThinking(provider, ctx) ??
    DEFAULT_AGENT_THINKING;

  validateModel(provider, model);
  return {provider, model, thinking};
}

export async function createWorkspaceAgentDefaultsResolver(
  workspaceId: string,
): Promise<AgentDefaultsResolver> {
  const [settings, providerConfigs] = await Promise.all([
    getAgentWorkspaceSettings(workspaceId),
    listAgentProviderConfigs(workspaceId),
  ]);
  const workspaceProviderConfigs = new Map(
    providerConfigs.map((providerConfig) => [
      providerConfig.providerId,
      {
        defaultModel: providerConfig.defaultModel,
        defaultThinking: providerConfig.defaultThinking,
      },
    ]),
  );
  const ctx: AgentConfigResolutionContext = {
    workspaceDefaultProviderId: settings?.defaultProviderId,
    workspaceProviderConfigs,
    instanceDefaultProvider: config.AGENT_DEFAULT_PROVIDER as SupportedAgentProviderId | undefined,
    instanceDefaultProviderModel: config.AGENT_DEFAULT_PROVIDER_MODEL,
    instanceDefaultProviderThinking: config.AGENT_DEFAULT_PROVIDER_THINKING as
      | AgentThinking
      | undefined,
  };

  return (step) => resolveAgentConfig(step, ctx);
}

export const catalogDefaultAgentResolver: AgentDefaultsResolver = (step) =>
  resolveAgentConfig(step);

function resolveProvider(
  step: ContextualAgentConfig,
  ctx: AgentConfigResolutionContext,
): SupportedAgentProviderId {
  const provider =
    step.provider ??
    ctx.workspaceDefaultProviderId ??
    ctx.instanceDefaultProvider ??
    DEFAULT_AGENT_PROVIDER;
  const entry = getAgentProviderEntry(provider);
  if (entry === undefined || entry.support_status !== 'supported') {
    throw new UnsupportedAgentProviderError(provider);
  }
  return provider as SupportedAgentProviderId;
}

function catalogDefaultModel(provider: SupportedAgentProviderId): string {
  const entry = getAgentProviderEntry(provider);
  if (entry === undefined || entry.support_status !== 'supported' || entry.default_model === null) {
    throw new UnsupportedAgentProviderError(provider);
  }
  return entry.default_model;
}

function instanceDefaultModel(
  provider: SupportedAgentProviderId,
  ctx: AgentConfigResolutionContext,
): string | undefined {
  return provider === ctx.instanceDefaultProvider ? ctx.instanceDefaultProviderModel : undefined;
}

function instanceDefaultThinking(
  provider: SupportedAgentProviderId,
  ctx: AgentConfigResolutionContext,
): AgentThinking | undefined {
  return provider === ctx.instanceDefaultProvider ? ctx.instanceDefaultProviderThinking : undefined;
}

function validateModel(provider: SupportedAgentProviderId, model: string): void {
  const found = getModels(provider as KnownProvider).some((candidate) => candidate.id === model);
  if (!found) throw new InvalidAgentModelError(provider, model);
}
