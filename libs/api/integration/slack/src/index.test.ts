import {createSlackIntegrationProvider, slackAgentToolCatalog} from '#index.js';

describe('createSlackIntegrationProvider', () => {
  it('does not mount webhook routes without route options', () => {
    const provider = createSlackIntegrationProvider();

    expect(provider.routes).toEqual([]);
  });

  it('rejects incomplete webhook route options', () => {
    expect(() => createSlackIntegrationProvider({routes: {}})).toThrow(
      'Slack webhook routes require every core persistence dependency',
    );
  });

  it('exposes the Slack agent-tools adapter when token access is configured', () => {
    const provider = createSlackIntegrationProvider({
      agentTools: {tokenStore: {getAccessToken: async () => 'xoxb-token'}},
    });

    const catalog = provider.adapters.agent_tools?.catalog();

    expect(catalog).toBe(slackAgentToolCatalog);
  });
});
