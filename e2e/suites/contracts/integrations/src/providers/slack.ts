import {createSlackApiClient, SlackAgentToolsProvider} from '@shipfox/api-integration-slack';
import type {SlackContractAccess} from '../fakes/slack.js';

/** The Slack tool adapter, with the fake's bot token in place of the secret store. */
export function slackContractTools(access: SlackContractAccess): SlackAgentToolsProvider {
  return new SlackAgentToolsProvider({
    slack: createSlackApiClient(),
    tokenStore: {getAccessToken: () => Promise.resolve(access.botToken)},
  });
}
