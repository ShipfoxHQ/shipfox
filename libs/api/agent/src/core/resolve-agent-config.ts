import {getModels, type KnownProvider} from '@earendil-works/pi-ai';
import {
  type AgentThinking,
  type CustomAgentModelDto,
  DEFAULT_AGENT_THINKING,
  DEFAULT_HARNESS,
  DEFAULT_MODEL_PROVIDER,
  getModelProviderEntry,
  type Harness,
  type ModelProviderRef,
  type SupportedModelProviderId,
} from '@shipfox/api-agent-dto';
import {InvalidAgentModelError, UnsupportedModelProviderError} from './errors.js';

export interface ContextualAgentConfig {
  readonly harness?: Harness | undefined;
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  readonly thinking?: AgentThinking | undefined;
}

export interface ResolvedAgentConfig {
  readonly harness: Harness;
  readonly provider: ModelProviderRef;
  readonly model: string;
  readonly thinking: AgentThinking;
}

export type AgentDefaultsResolver = (step: ContextualAgentConfig) => ResolvedAgentConfig;

export interface AgentConfigResolutionContext {
  readonly workspaceDefaultProviderId?: ModelProviderRef | null | undefined;
  readonly workspaceProviderConfigs?: ReadonlyMap<ModelProviderRef, WorkspaceProviderDefaults>;
  readonly instanceDefaultProvider?: SupportedModelProviderId | undefined;
  readonly instanceDefaultModel?: string | undefined;
  readonly instanceDefaultThinking?: AgentThinking | undefined;
}

interface WorkspaceProviderDefaults {
  readonly kind?: 'builtin' | 'custom' | undefined;
  readonly defaultModel: string | null;
  readonly defaultThinking: AgentThinking;
  readonly models?: readonly CustomAgentModelDto[] | null | undefined;
}

export function resolveAgentConfig(
  step: ContextualAgentConfig,
  ctx: AgentConfigResolutionContext = {},
): ResolvedAgentConfig {
  const harness = step.harness ?? DEFAULT_HARNESS;
  const provider = resolveProvider(step, ctx);
  const workspaceProviderConfig = ctx.workspaceProviderConfigs?.get(provider);
  const model =
    step.model ??
    workspaceProviderConfig?.defaultModel ??
    customDefaultModel(workspaceProviderConfig) ??
    instanceDefaultModel(provider, ctx) ??
    catalogDefaultModel(provider);
  const thinking =
    step.thinking ??
    workspaceProviderConfig?.defaultThinking ??
    instanceDefaultThinking(provider, ctx) ??
    DEFAULT_AGENT_THINKING;

  validateModel(provider, model, workspaceProviderConfig);
  return {harness, provider, model, thinking};
}

export const catalogDefaultAgentResolver: AgentDefaultsResolver = (step) =>
  resolveAgentConfig(step);

function resolveProvider(
  step: ContextualAgentConfig,
  ctx: AgentConfigResolutionContext,
): ModelProviderRef {
  const provider =
    step.provider ??
    ctx.workspaceDefaultProviderId ??
    ctx.instanceDefaultProvider ??
    DEFAULT_MODEL_PROVIDER;
  const workspaceProviderConfig = ctx.workspaceProviderConfigs?.get(provider);
  if (workspaceProviderConfig?.kind === 'custom') return provider;

  const entry = getModelProviderEntry(provider);
  if (entry === undefined || entry.support_status !== 'supported') {
    throw new UnsupportedModelProviderError(provider);
  }
  return provider as SupportedModelProviderId;
}

function catalogDefaultModel(provider: ModelProviderRef): string {
  const entry = getModelProviderEntry(provider);
  if (entry === undefined || entry.support_status !== 'supported' || entry.default_model === null) {
    throw new UnsupportedModelProviderError(provider);
  }
  return entry.default_model;
}

function instanceDefaultModel(
  provider: ModelProviderRef,
  ctx: AgentConfigResolutionContext,
): string | undefined {
  return provider === ctx.instanceDefaultProvider ? ctx.instanceDefaultModel : undefined;
}

function instanceDefaultThinking(
  provider: ModelProviderRef,
  ctx: AgentConfigResolutionContext,
): AgentThinking | undefined {
  return provider === ctx.instanceDefaultProvider ? ctx.instanceDefaultThinking : undefined;
}

function customDefaultModel(
  workspaceProviderConfig: WorkspaceProviderDefaults | undefined,
): string | undefined {
  if (workspaceProviderConfig?.kind !== 'custom') return undefined;
  return workspaceProviderConfig.models?.[0]?.id;
}

function validateModel(
  provider: ModelProviderRef,
  model: string,
  workspaceProviderConfig: WorkspaceProviderDefaults | undefined,
): void {
  if (workspaceProviderConfig?.kind === 'custom') {
    const found = workspaceProviderConfig.models?.some((candidate) => candidate.id === model);
    if (!found) throw new InvalidAgentModelError(provider, model);
    return;
  }

  const found = getModels(provider as KnownProvider).some((candidate) => candidate.id === model);
  if (!found) throw new InvalidAgentModelError(provider, model);
}
