import {createLinearIntegrationProvider} from '@shipfox/api-integration-linear';
import type {AgentToolsProvider, IntegrationConnection} from '@shipfox/api-integration-spi';
import type {LinearContractAccess} from '../fakes/linear.js';

/** The Linear tool adapter, with the fake's endpoint and access token in place of the token store. */
export function linearContractTools(
  access: LinearContractAccess,
): AgentToolsProvider<IntegrationConnection<'linear'>> {
  const {adapters} = createLinearIntegrationProvider({
    agentTools: {
      tokenStore: {getAccessToken: () => Promise.resolve(access.accessToken)},
      endpoint: access.endpoint,
    },
  });
  if (!('agent_tools' in adapters)) {
    throw new Error('The Linear provider has no agent tools adapter.');
  }
  return adapters.agent_tools;
}
