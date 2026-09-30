import {clickupAgentToolCatalog} from '@shipfox/api-integration-clickup/agent-tools';
import {discordAgentToolCatalog} from '@shipfox/api-integration-discord/agent-tools';
import {giteaAgentToolCatalog} from '@shipfox/api-integration-gitea/agent-tools';
import {githubAgentToolCatalog} from '@shipfox/api-integration-github/agent-tools';
import {jiraAgentToolCatalog} from '@shipfox/api-integration-jira/agent-tools';
import {linearAgentToolCatalog} from '@shipfox/api-integration-linear/agent-tools';
import {notionAgentToolCatalog} from '@shipfox/api-integration-notion/agent-tools';
import {posthogAgentToolCatalog} from '@shipfox/api-integration-posthog/agent-tools';
import {sentryAgentToolCatalog} from '@shipfox/api-integration-sentry/agent-tools';
import {shipfoxAgentToolCatalog} from '@shipfox/api-integration-shipfox/agent-tools';
import {slackAgentToolCatalog} from '@shipfox/api-integration-slack/agent-tools';
import type {AgentToolCatalogEntry} from '@shipfox/api-integration-spi';

export interface ProviderToolCatalog {
  /** The provider slug a manifest names in `integrations.<alias>.provider`. */
  provider: string;
  tools: readonly AgentToolCatalogEntry[];
}

export const providerToolCatalogs: readonly ProviderToolCatalog[] = [
  {provider: 'clickup', tools: clickupAgentToolCatalog},
  {provider: 'discord', tools: discordAgentToolCatalog},
  {provider: 'gitea', tools: giteaAgentToolCatalog},
  {provider: 'github', tools: githubAgentToolCatalog},
  {provider: 'jira', tools: jiraAgentToolCatalog},
  {provider: 'linear', tools: linearAgentToolCatalog},
  {provider: 'notion', tools: notionAgentToolCatalog},
  {provider: 'posthog', tools: posthogAgentToolCatalog},
  {provider: 'sentry', tools: sentryAgentToolCatalog},
  {provider: 'shipfox', tools: shipfoxAgentToolCatalog},
  {provider: 'slack', tools: slackAgentToolCatalog},
];
