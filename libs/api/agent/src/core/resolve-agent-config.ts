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
  readonly workspaceDefaultModelProviderId?: SupportedModelProviderId | null | undefined;
  readonly workspaceModelProviderConfigs?: ReadonlyMap<
    SupportedModelProviderId,
    WorkspaceModelProviderDefaults
  >;
  readonly instanceDefaultModelProvider?: SupportedModelProviderId | undefined;
  readonly instanceDefaultModelProviderModel?: string | undefined;
  readonly instanceDefaultModelProviderThinking?: AgentThinking | undefined;
}

interface WorkspaceModelProviderDefaults {
  readonly defaultModel: string | null;
  readonly defaultThinking: AgentThinking;
}

export function resolveAgentConfig(
  step: ContextualAgentConfig,
  ctx: AgentConfigResolutionContext = {},
): ResolvedAgentConfig {
  const modelProvider = resolveModelProvider(step, ctx);
  const workspaceModelProviderConfig = ctx.workspaceModelProviderConfigs?.get(modelProvider);
  const model =
    step.model ??
    workspaceModelProviderConfig?.defaultModel ??
    instanceDefaultModelProviderModel(modelProvider, ctx) ??
    catalogDefaultModel(modelProvider);
  const thinking =
    step.thinking ??
    workspaceModelProviderConfig?.defaultThinking ??
    instanceDefaultModelProviderThinking(modelProvider, ctx) ??
    DEFAULT_AGENT_THINKING;

  validateModel(modelProvider, model);
  return {provider: modelProvider, model, thinking};
}

export const catalogDefaultAgentResolver: AgentDefaultsResolver = (step) =>
  resolveAgentConfig(step);

function resolveModelProvider(
  step: ContextualAgentConfig,
  ctx: AgentConfigResolutionContext,
): SupportedModelProviderId {
  const modelProvider =
    step.provider ??
    ctx.workspaceDefaultModelProviderId ??
    ctx.instanceDefaultModelProvider ??
    DEFAULT_MODEL_PROVIDER;
  const entry = getModelProviderEntry(modelProvider);
  if (entry === undefined || entry.support_status !== 'supported') {
    throw new UnsupportedModelProviderError(modelProvider);
  }
  return modelProvider as SupportedModelProviderId;
}

function catalogDefaultModel(provider: SupportedModelProviderId): string {
  const entry = getModelProviderEntry(provider);
  if (entry === undefined || entry.support_status !== 'supported' || entry.default_model === null) {
    throw new UnsupportedModelProviderError(provider);
  }
  return entry.default_model;
}

function instanceDefaultModelProviderModel(
  provider: SupportedModelProviderId,
  ctx: AgentConfigResolutionContext,
): string | undefined {
  return provider === ctx.instanceDefaultModelProvider
    ? ctx.instanceDefaultModelProviderModel
    : undefined;
}

function instanceDefaultModelProviderThinking(
  provider: SupportedModelProviderId,
  ctx: AgentConfigResolutionContext,
): AgentThinking | undefined {
  return provider === ctx.instanceDefaultModelProvider
    ? ctx.instanceDefaultModelProviderThinking
    : undefined;
}

function validateModel(provider: SupportedModelProviderId, model: string): void {
  const found = getModels(provider as KnownProvider).some((candidate) => candidate.id === model);
  if (!found) throw new InvalidAgentModelError(provider, model);
}
