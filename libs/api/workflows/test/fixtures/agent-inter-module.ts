import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import type {AgentDefaultsResolver} from '#core/agent-defaults.js';

export const agentTestClient: AgentInterModuleClient = {
  resolveAgentConfig({config}) {
    return Promise.resolve({
      harness: config.harness ?? 'pi',
      provider: config.provider ?? 'anthropic',
      model: config.model ?? 'claude-opus-4-8',
      thinking: config.thinking ?? 'medium',
    });
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

export const resolveTestAgentDefaults: AgentDefaultsResolver = (config) => ({
  harness: config.harness ?? 'pi',
  provider: config.provider ?? 'anthropic',
  model: config.model ?? 'claude-opus-4-8',
  thinking: config.thinking ?? 'medium',
});
