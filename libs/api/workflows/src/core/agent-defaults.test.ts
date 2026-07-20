import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {createAgentDefaultsResolver} from './agent-defaults.js';

describe('createAgentDefaultsResolver', () => {
  test('omits unresolved optional fields from the inter-module input', async () => {
    const resolveAgentConfig = vi.fn().mockResolvedValue({
      harness: 'pi',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'xhigh',
    });
    const agent = {resolveAgentConfig} as unknown as AgentInterModuleClient;
    const resolve = createAgentDefaultsResolver(agent, crypto.randomUUID());

    const defaults = await resolve({});

    expect(defaults).toEqual({
      harness: 'pi',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'xhigh',
    });
    expect(resolveAgentConfig).toHaveBeenCalledWith({
      workspaceId: expect.any(String),
      config: {},
    });
  });
});
