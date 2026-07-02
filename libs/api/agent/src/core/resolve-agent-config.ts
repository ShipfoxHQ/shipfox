import {getModels, type KnownProvider} from '@earendil-works/pi-ai';
import {
  type AgentThinking,
  DEFAULT_AGENT_THINKING,
  DEFAULT_MODEL_PROVIDER,
  getModelProviderEntry,
  type SupportedModelProviderId,
} from '@shipfox/api-agent-dto';
import {InvalidAgentModelError, UnsupportedModelProviderError} from './errors.js';

export interface ContextualAgentConfig {
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  readonly thinking?: AgentThinking | undefined;
}

export interface ResolvedAgentConfig {
  readonly provider: SupportedModelProviderId;
  readonly model: string;
  readonly thinking: AgentThinking;
}

export type AgentDefaultsResolver = (step: ContextualAgentConfig) => ResolvedAgentConfig;

export interface AgentConfigResolutionContext {
  readonly workspaceDefaultProviderId?: SupportedModelProviderId | null | undefined;
  readonly workspaceProviderConfigs?: ReadonlyMap<
    SupportedModelProviderId,
    WorkspaceProviderDefaults
  >;
  readonly instanceDefaultProvider?: SupportedModelProviderId | undefined;
  readonly instanceDefaultModel?: string | undefined;
  readonly instanceDefaultThinking?: AgentThinking | undefined;
}

interface WorkspaceProviderDefaults {
  readonly defaultModel: string | null;
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

export const catalogDefaultAgentResolver: AgentDefaultsResolver = (step) =>
  resolveAgentConfig(step);

function resolveProvider(
  step: ContextualAgentConfig,
  ctx: AgentConfigResolutionContext,
): SupportedModelProviderId {
  const provider =
    step.provider ??
    ctx.workspaceDefaultProviderId ??
    ctx.instanceDefaultProvider ??
    DEFAULT_MODEL_PROVIDER;
  const entry = getModelProviderEntry(provider);
  if (entry === undefined || entry.support_status !== 'supported') {
    throw new UnsupportedModelProviderError(provider);
  }
  return provider as SupportedModelProviderId;
}

function catalogDefaultModel(provider: SupportedModelProviderId): string {
  const entry = getModelProviderEntry(provider);
  if (entry === undefined || entry.support_status !== 'supported' || entry.default_model === null) {
    throw new UnsupportedModelProviderError(provider);
  }
  return entry.default_model;
}

function instanceDefaultModel(
  provider: SupportedModelProviderId,
  ctx: AgentConfigResolutionContext,
): string | undefined {
  return provider === ctx.instanceDefaultProvider ? ctx.instanceDefaultModel : undefined;
}

function instanceDefaultThinking(
  provider: SupportedModelProviderId,
  ctx: AgentConfigResolutionContext,
): AgentThinking | undefined {
  return provider === ctx.instanceDefaultProvider ? ctx.instanceDefaultThinking : undefined;
}

function validateModel(provider: SupportedModelProviderId, model: string): void {
  const found = getModels(provider as KnownProvider).some((candidate) => candidate.id === model);
  if (!found) throw new InvalidAgentModelError(provider, model);
}
