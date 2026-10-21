import {
  ClickUpAgentToolsProvider,
  createClickUpAgentToolsClient,
} from '@shipfox/api-integration-clickup';
import type {ClickUpContractAccess} from '../fakes/clickup.js';

/** The ClickUp tool adapter, with the fake's access token in place of the secret store. */
export function clickupContractTools(access: ClickUpContractAccess): ClickUpAgentToolsProvider {
  return new ClickUpAgentToolsProvider({
    clickup: createClickUpAgentToolsClient(),
    tokenStore: {getAccessToken: () => Promise.resolve(access.accessToken)},
  });
}
