import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import type {AgentDefaultsResolver} from '#core/agent-defaults.js';

export const agentTestClient: AgentInterModuleClient = {
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
