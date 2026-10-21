import {
  createNotionAgentToolsClient,
  NotionAgentToolsProvider,
} from '@shipfox/api-integration-notion';
import type {NotionContractAccess} from '../fakes/notion.js';

/** The Notion tool adapter, with the fake's access token in place of the secret store. */
export function notionContractTools(access: NotionContractAccess): NotionAgentToolsProvider {
  return new NotionAgentToolsProvider({
    notion: createNotionAgentToolsClient(),
    tokenStore: {getAccessToken: () => Promise.resolve(access.accessToken)},
  });
}
