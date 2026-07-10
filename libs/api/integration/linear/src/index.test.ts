import {linearAgentToolCatalog} from '#core/agent-tools.js';
import {createLinearIntegrationProvider} from '#index.js';

describe('createLinearIntegrationProvider', () => {
  it('does not wire the Linear agent tools adapter without a token store', () => {
    const provider = createLinearIntegrationProvider();

    expect(provider.adapters.agent_tools).toBeUndefined();
  });

  it('wires the Linear agent tools adapter when a token store is provided', () => {
    const provider = createLinearIntegrationProvider({
      agentTools: {
        tokenStore: {getAccessToken: async () => 'linear-token'},
      },
    });

    expect(provider.adapters.agent_tools?.catalog()).toBe(linearAgentToolCatalog);
  });
});
