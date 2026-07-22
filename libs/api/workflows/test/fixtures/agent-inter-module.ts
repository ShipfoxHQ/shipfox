import {
  DEFAULT_HARNESS_TOOL_DEPLOYMENT_CONFIG,
  getModelProviderEntry,
  listEnabledHarnessTools,
  listHarnessDescriptors,
  MODEL_PROVIDER_IDS,
} from '@shipfox/api-agent-dto';
import type {
  AgentInterModuleClient,
  AgentValidationCatalog,
} from '@shipfox/api-agent-dto/inter-module';
import type {AgentDefaultsResolver} from '#core/agent-defaults.js';

export const agentValidationCatalog: AgentValidationCatalog = {
  version: 1,
  providers: MODEL_PROVIDER_IDS.map((id) => ({
    id,
    support_status: getModelProviderEntry(id)?.support_status ?? 'unsupported',
  })),
  harnesses: listHarnessDescriptors().map((harness) => ({
    id: harness.id,
    supported_provider_ids: [...harness.supportedProviderIds],
    thinking_levels: [...harness.thinkingLevels],
    effective_tools: listEnabledHarnessTools(
      harness.id,
      DEFAULT_HARNESS_TOOL_DEPLOYMENT_CONFIG,
    ).map((tool) => tool.name),
  })),
};

export const agentTestClient: AgentInterModuleClient = {
  getValidationCatalog() {
    return Promise.resolve(agentValidationCatalog);
  },
  resolveAgentConfig({config}) {
    return Promise.resolve(resolveTestAgentDefaults(config));
  },
  resolveRuntimeCredentials({harness, provider, model, thinking}) {
    return Promise.resolve({
      harness,
      provider_id: provider,
      model,
      thinking,
      credentials: {api_key: 'test-agent-credential'},
    });
  },
};

export const resolveTestAgentDefaults: AgentDefaultsResolver = (config) => {
  const provider = config.provider ?? 'anthropic';
  return {
    harness: config.harness ?? 'pi',
    provider,
    model: config.model ?? (provider === 'openai' ? 'gpt-5.5-pro' : 'claude-opus-4-8'),
    thinking: config.thinking ?? 'xhigh',
  };
};
