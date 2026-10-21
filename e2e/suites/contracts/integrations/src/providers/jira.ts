import {createJiraAgentToolsClient, JiraAgentToolsProvider} from '@shipfox/api-integration-jira';
import type {JiraContractAccess} from '../fakes/jira.js';

/**
 * The Jira tool adapter, with the fake's access token in place of the secret store. The cloud id
 * is the connection's external account id, and the fake serves any.
 */
export function jiraContractTools(access: JiraContractAccess): JiraAgentToolsProvider {
  return new JiraAgentToolsProvider({
    jira: createJiraAgentToolsClient(),
    tokenStore: {getAccessToken: () => Promise.resolve(access.accessToken)},
  });
}
